# Eternal Life AI - chat-style persona MVP

Upload screenshots of a chat conversation. The app reads them, learns how one
person writes, and lets you talk to an AI that replies in that style.

No login. No database. No file storage. No paid services. Deploys to Vercel free tier.

## How it actually works

There is **no model training or fine-tuning**. No free API offers it, and 50
images is not a training set. What happens instead:

1. **Extract**: screenshots are downscaled in the browser, batched, and sent to
   a vision model via OpenRouter, which transcribes every message with its sender.
2. **Distil**: the transcript is analysed into a structured *style profile*,
   casing, punctuation, message length, signature phrases, emoji, topics, quirks,
   and 8–15 verbatim example messages.
3. **Imitate**: every chat turn injects that profile, plus real excerpts matching
   what you just said, into the system prompt.

From the user's side the result is the same: upload, then chat with something
that sounds like them. This is prompt-based persona cloning, and for style
mimicry it works better than fine-tuning on a set this small.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your key
npm run dev
```

Get a free key at **https://openrouter.ai/keys**.

```
OPENROUTER_API_KEY=sk-or-v1-...
LLM_MODEL="openai/gpt-oss-20b:free"
LLM_VISION_MODEL="google/gemma-4-31b-it:free"
```

Open http://localhost:3000.

### Why two models

`LLM_MODEL` handles chat and the style profile. `LLM_VISION_MODEL` reads the
screenshots, so it **must** accept image input. `gpt-oss-20b` is text-only and
returns an error if used for extraction. Both auto-fall-back if a model is
unavailable or rate-limited.

## Deploy to Vercel

```bash
npx vercel
```

Then add `OPENROUTER_API_KEY` under **Project → Settings → Environment
Variables** and redeploy. Nothing else to configure: no database, no bucket.

## Free-tier limits: read this before demoing

OpenRouter free models allow **20 requests/minute** and, more importantly,
**50 requests/day** until the account has purchased at least $10 in credits.
After that it is 1,000/day.

**That 50/day cap is the binding constraint.** The upload step sends 4
screenshots per request, so:

| Screenshots | Requests | Fits in 50/day? |
| :--- | :--- | :--- |
| 20 | 5 | yes, comfortably |
| 50 | 13 | yes, but ~1/4 of the daily budget |
| 200 | 50 | no, one upload consumes the entire day |

Chat replies cost one request each on top of that.

**Recommendation:** put $10 of credits on the OpenRouter account before any
client demo. The `:free` models stay free; the deposit only lifts the daily
cap to 1,000. Without it, a few test runs can exhaust the day mid-demo.

Free models also share an upstream pool, so **429s are routine**. The app
retries with backoff and falls through to alternate models automatically.

## Tuning

| Want | Change |
| :--- | :--- |
| Faster upload (risk 429s) | `BATCH_SIZE` ↑ / `PAUSE_MS` ↓ in `src/components/Upload.tsx` |
| More faithful mimicry | `temperature` in `src/app/api/chat/route.ts` (currently 0.95) |
| Better OCR on dense screenshots | `maxDim` in `src/lib/images.ts` (currently 1200) |
| Different model | `LLM_MODEL` / `LLM_VISION_MODEL` env vars |

## Structure

```
src/
  app/
    page.tsx              three-stage flow: upload → pick sender → chat
    api/extract/route.ts  screenshots → messages (vision)
    api/profile/route.ts  messages → style profile
    api/chat/route.ts     profile + excerpts → streamed reply
  components/             Upload, PickSender, Chat
  lib/
    llm.ts                OpenRouter client, model fallback, streaming, JSON parsing
    images.ts             browser downscale, batching, natural sort
    storage.ts            localStorage persona + turns
    types.ts
```

## Known limits

- **Everything is in `localStorage`.** Clearing browser data loses the persona.
  Intentional: it is what "no database" means.
- **The transcript is re-sent on every chat turn.** Fine at this size; would need
  server-side storage to scale.
- **The API key is server-side only** (routes run on Node), so it is not exposed
  to the browser. But there is **no auth and no rate limiting**, so a public
  deployment can have its quota drained by anyone who finds the URL. Keep the URL
  private, or add a shared password before sharing it widely.
- **Sender detection depends on the screenshots.** If names are not visible the
  model falls back to bubble alignment, which assumes the screenshots came from
  the uploader's phone.

## Consent

Cloning how a real person writes, especially someone deceased, needs the
agreement of whoever holds that right. Worth settling before this goes in front
of anyone, not after.
