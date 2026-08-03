import { GoogleGenAI } from '@google/genai';

/**
 * Google retires model IDs faster than it announces. gemini-2.5-flash started
 * returning 404 "no longer available to new users" months ahead of its stated
 * shutdown date, which breaks any app pinned to a single ID.
 *
 * So we try a chain, newest first, and cache whichever one the key can actually
 * reach. Setting GEMINI_CHAT_MODEL / GEMINI_VISION_MODEL overrides the chain.
 */
const FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-2.5-flash',
];

const VISION_MODELS = process.env.GEMINI_VISION_MODEL
  ? [process.env.GEMINI_VISION_MODEL]
  : FALLBACK_MODELS;

const CHAT_MODELS = process.env.GEMINI_CHAT_MODEL
  ? [process.env.GEMINI_CHAT_MODEL]
  : FALLBACK_MODELS;

/** First model ID confirmed working this process, so we only pay discovery once. */
let resolvedModel: string | null = null;

/** A 404/NOT_FOUND means the ID is retired; move to the next candidate. */
function isModelMissing(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('no longer available') ||
    msg.includes('is not found') ||
    msg.includes('not supported for')
  );
}

/**
 * Runs `call` against each candidate until one works. Any error that is not a
 * missing-model error propagates immediately, so real failures are not masked.
 */
export async function withModelFallback<T>(
  candidates: string[],
  call: (model: string) => Promise<T>
): Promise<T> {
  const ordered = resolvedModel
    ? [resolvedModel, ...candidates.filter((m) => m !== resolvedModel)]
    : candidates;

  let lastErr: unknown;
  for (const model of ordered) {
    try {
      const out = await call(model);
      resolvedModel = model;
      return out;
    } catch (err) {
      lastErr = err;
      if (!isModelMissing(err)) throw err;
    }
  }

  throw new Error(
    `None of these models are available to your API key: ${ordered.join(', ')}. ` +
      `Check https://ai.google.dev/gemini-api/docs/models for a current ID and set ` +
      `GEMINI_CHAT_MODEL in your environment. Original error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`
  );
}

let client: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to .env.local'
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export { VISION_MODELS, CHAT_MODELS };

/**
 * The Gemini API is unavailable in some countries. Locally that means the app
 * cannot run without a VPN; deployed on Vercel the request originates from a
 * supported region, so it works. Worth saying plainly rather than surfacing a
 * bare 400.
 */
export function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/user location is not supported/i.test(msg)) {
    return (
      'The Gemini API is not available from your current location. Deploy to ' +
      'Vercel (its servers are in a supported region) or use a VPN to develop locally.'
    );
  }
  if (/api[_ ]?key not valid|api key expired|invalid api key/i.test(msg)) {
    return 'That Gemini API key is not valid. Generate a new one at https://aistudio.google.com/apikey';
  }
  return msg;
}

/** Free tier is ~10-15 RPM, so a 429 is an expected event, not an exception. */
function isRetryable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('500') ||
    msg.includes('internal')
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries with exponential backoff. Free-tier rate limits are the single most
 * likely failure during a 50-screenshot upload, so every model call goes
 * through here.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 2000 } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      // 2s, 4s, 8s, plus jitter so parallel batches don't sync up.
      await sleep(baseDelayMs * 2 ** i + Math.floor(Math.random() * 500));
    }
  }
  throw lastErr;
}

/**
 * Models wrap JSON in prose or fences often enough that parsing needs to be
 * defensive. Falls back to the outermost brace/bracket span.
 */
export function parseJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Model did not return valid JSON. Got: ${cleaned.slice(0, 200)}`);
  }
}
