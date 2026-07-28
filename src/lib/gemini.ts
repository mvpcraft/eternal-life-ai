import { GoogleGenAI } from '@google/genai';

const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

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

export { VISION_MODEL, CHAT_MODEL };

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
