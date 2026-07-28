# Eternal Life AI — chat-style persona MVP

Upload screenshots of a chat conversation. The app reads them, learns how one
person writes, and lets you talk to an AI that replies in that style.

No login. No database. No file storage. No paid services. Deploys to Vercel free tier.

## How it actually works

There is **no model training or fine-tuning** — no free API offers it, and 50
images is not a training set. What happens instead:

1. **Extract** — screenshots are downscaled in the browser, batched, and sent to
   Gemini Vision, which transcribes every message with its sender.
2. **Distil** — the transcript is analysed into a structured *style profile*:
   casing, punctuation, message length, signature phrases, emoji, topics, quirks,
   and 8–15 verbatim example messages.
3. **Imitate** — every chat turn injects that profile, plus real excerpts matching
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

Get a free Gemini key at **https://aistudio.google.com/apikey** — no credit card.

```
GEMINI_API_KEY=your_key_here
```

Open http://localhost:3000.

## Deploy to Vercel

```bash
npx vercel
```

Then add `GEMINI_API_KEY` under **Project → Settings → Environment Variables**
and redeploy. Nothing else to configure — no database, no bucket.

## Free-tier limits, and what they mean for the demo

Gemini free tier is roughly **10–15 requests/minute** and **~1,500/day**
(Google cut these substantially in late 2025).

The upload step therefore:
- sends **4 screenshots per request**
- **pauses ~4.5s between batches** to stay under the ceiling
- retries with exponential backoff on 429/503

**50 screenshots ≈ 13 requests ≈ 1–2 minutes.** The progress bar says so, because
a silent two-minute wait reads as a hang.

Practical ceiling is around **60 screenshots per session**. 500 is not viable on
a free tier — it would take most of an hour and burn the daily quota.

## Tuning

| Want | Change |
| :--- | :--- |
| Faster upload (risk 429s) | `BATCH_SIZE` ↑ / `PAUSE_MS` ↓ in `src/components/Upload.tsx` |
| More faithful mimicry | `temperature` in `src/app/api/chat/route.ts` (currently 0.95) |
| Better OCR on dense screenshots | `maxDim` in `src/lib/images.ts` (currently 1200) |
| Different model | `GEMINI_CHAT_MODEL` / `GEMINI_VISION_MODEL` env vars |

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
    gemini.ts             client, retry/backoff, JSON parsing
    images.ts             browser downscale, batching, natural sort
    storage.ts            localStorage persona + turns
    types.ts
```

## Known limits

- **Everything is in `localStorage`.** Clearing browser data loses the persona.
  Intentional — it is what "no database" means.
- **The transcript is re-sent on every chat turn.** Fine at this size; would need
  server-side storage to scale.
- **The API key is server-side only** (routes run on Node), so it is not exposed
  to the browser. But there is **no auth and no rate limiting** — a public
  deployment can have its quota drained by anyone who finds the URL. Keep the URL
  private, or add a shared password before sharing it widely.
- **Sender detection depends on the screenshots.** If names are not visible the
  model falls back to bubble alignment, which assumes the screenshots came from
  the uploader's phone.

## Consent

Cloning how a real person writes — especially someone deceased — needs the
agreement of whoever holds that right. Worth settling before this goes in front
of anyone, not after.
