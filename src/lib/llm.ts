/**
 * OpenRouter client.
 *
 * One HTTP endpoint, OpenAI-compatible, so swapping models is a config change.
 * No vendor SDK: the chat-completions shape is stable and the surface we need
 * is small.
 */

const BASE = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Screenshot reading needs image input. Most :free models are text-only, so the
 * vision chain is separate from the text chain and must stay vision-capable.
 */
const VISION_FALLBACKS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

const TEXT_FALLBACKS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-4-31b-it:free',
  'inclusionai/ling-3.0-flash:free',
];

export const VISION_MODELS = process.env.LLM_VISION_MODEL
  ? [process.env.LLM_VISION_MODEL, ...VISION_FALLBACKS]
  : VISION_FALLBACKS;

export const TEXT_MODELS = process.env.LLM_MODEL
  ? [process.env.LLM_MODEL, ...TEXT_FALLBACKS]
  : TEXT_FALLBACKS;

export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type Content = string | (TextPart | ImagePart)[];
export type Msg = { role: 'system' | 'user' | 'assistant'; content: Content };

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Get a free key at https://openrouter.ai/keys and add it to .env.local'
    );
  }
  return key;
}

function headers() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    // OpenRouter uses these for attribution; harmless if unset.
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': 'Eternal Life AI',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Free models sit in a shared upstream pool, so 429s are routine, not fatal. */
function isTransient(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /rate.?limit|temporarily|overloaded|timeout/i.test(body)
  );
}

/** A model that is gone, renamed, or not valid for this key: try the next one. */
function isModelUnavailable(status: number, body: string): boolean {
  return (
    status === 404 ||
    /no endpoints found|not a valid model|does not exist|no longer available/i.test(body)
  );
}

/** First model confirmed working this process, so discovery is paid once. */
let resolved: Record<string, string> = {};

type CallOpts = {
  messages: Msg[];
  models: string[];
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
  /** Abort an upstream that stalls, so a request can never hang forever. */
  timeoutMs?: number;
  /** Cache bucket, so vision and text resolve independently. */
  kind: 'vision' | 'text';
};

async function once(model: string, o: CallOpts): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: headers(),
    signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
    body: JSON.stringify({
      model,
      messages: o.messages,
      temperature: o.temperature ?? 0.7,
      max_tokens: o.maxTokens ?? 2048,
      // Reasoning models otherwise burn the token budget thinking before
      // answering, which for short chat replies is pure latency.
      reasoning: { exclude: true },
      ...(o.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const raw = await res.text();

  if (!res.ok) {
    const err = new Error(`${res.status}: ${raw.slice(0, 300)}`);
    (err as { status?: number }).status = res.status;
    (err as { body?: string }).body = raw;
    throw err;
  }

  let data: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
  }

  // OpenRouter can return 200 with an error body when a provider fails.
  if (data.error) {
    const err = new Error(data.error.message || 'Provider error');
    (err as { status?: number }).status = 429;
    (err as { body?: string }).body = raw;
    throw err;
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Model returned an empty response.');
  return text;
}

/**
 * Tries each model in turn. Transient failures retry with backoff on the same
 * model; a missing model advances to the next. Anything else propagates so real
 * bugs are not hidden behind a fallback.
 */
export async function complete(o: CallOpts): Promise<string> {
  const cached = resolved[o.kind];
  const ordered = cached
    ? [cached, ...o.models.filter((m) => m !== cached)]
    : o.models;

  let lastErr: unknown;

  for (const model of ordered) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await once(model, o);
        resolved[o.kind] = model;
        return out;
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status ?? 0;
        const body = (err as { body?: string }).body ?? String(err);

        if (isModelUnavailable(status, body)) break; // next model
        if (isTransient(status, body)) {
          if (attempt === 2) break; // exhausted here, try next model
          await sleep(1500 * 2 ** attempt + Math.floor(Math.random() * 400));
          continue;
        }
        throw err; // genuine error
      }
    }
  }

  throw new Error(
    `All models failed (${ordered.join(', ')}). Free models share an upstream pool ` +
      `and are often rate-limited; wait a moment and retry. Last error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`
  );
}

/** Streams tokens as they arrive. Falls back to a single blocking call. */
export async function stream(o: CallOpts): Promise<ReadableStream<Uint8Array>> {
  const cached = resolved[o.kind];
  const model = cached ?? o.models[0];

  const res = await fetch(BASE, {
    method: 'POST',
    headers: headers(),
    signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
    body: JSON.stringify({
      model,
      messages: o.messages,
      temperature: o.temperature ?? 0.7,
      max_tokens: o.maxTokens ?? 2048,
      reasoning: { exclude: true },
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    // Streaming failed; fall back to a normal call and emit it in one piece.
    const text = await complete(o);
    return new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
  }

  resolved[o.kind] = model;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = res.body.getReader();

  /**
   * `pull` is called once per chunk, but reasoning models (gpt-oss-20b among
   * them) emit many `delta.reasoning` frames carrying no visible content before
   * the first `delta.content`. Enqueueing nothing on those turns starves the
   * stream and the request hangs. So we drive the read loop ourselves in
   * `start` and only surface content deltas.
   */
  return new ReadableStream({
    async start(controller) {
      let buffer = '';
      let closed = false;

      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            // ": OPENROUTER PROCESSING" keep-alives arrive as SSE comments.
            if (!trimmed.startsWith('data:')) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              close();
              return;
            }

            try {
              const chunk = JSON.parse(payload);
              if (chunk.error) throw new Error(chunk.error.message || 'stream error');
              // Ignore delta.reasoning; only visible content reaches the user.
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch (err) {
              if (err instanceof SyntaxError) continue; // partial frame
              throw err;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream error';
        controller.enqueue(encoder.encode(`\n\n[${explain(msg)}]`));
      } finally {
        close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/** Models wrap JSON in prose or fences often enough to need defensive parsing. */
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

/** Turns opaque API errors into something a user can act on. */
export function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/401|no auth credentials|invalid api key/i.test(msg)) {
    return 'That OpenRouter API key is not valid. Check it at https://openrouter.ai/keys';
  }
  if (/402|credits|insufficient/i.test(msg)) {
    return 'OpenRouter reports insufficient credits for this model. Pick a :free model or add credits.';
  }
  if (/429|rate.?limit/i.test(msg)) {
    return 'Rate limited. Free models share an upstream pool, so this is common; wait a moment and retry.';
  }
  return msg;
}
