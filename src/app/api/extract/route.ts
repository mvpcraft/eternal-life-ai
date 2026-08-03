import { NextResponse } from 'next/server';
import { complete, VISION_MODELS, parseJson, explain } from '@/lib/llm';
import type { ImagePart, TextPart } from '@/lib/llm';
import type { ChatMessage, ExtractedBatch } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PROMPT = `You are reading screenshots of a chat conversation.

Transcribe EVERY message you can see, in the order they appear top to bottom, across all the images given (the images are consecutive screenshots of the same conversation).

Rules:
- Identify who sent each message. Use the contact name shown in the screenshot if there is one. If names are not visible, use "Me" for messages in bubbles aligned to the right, and "Them" for bubbles aligned to the left.
- Use the SAME sender label consistently across all images.
- Transcribe text exactly: keep original spelling, casing, slang, emoji, punctuation, and typos. Do not correct or clean anything. This is critical, because the errors and habits are the point.
- Include the visible timestamp if there is one.
- Skip UI chrome entirely: headers, battery/wifi icons, "delivered"/"read" receipts, typing indicators.
- NEVER output a date separator as a message. Lines like "06 NOV 2024", "Today", "Yesterday", "Mon, 12 Jan" are dividers drawn between messages, not things anyone said. Omit them completely, and never use one as a sender name.
- "sender" must be a person, never a date, time, or day name.
- If a message is an image/sticker/voice note with no text, represent it as [photo], [sticker], or [voice note].
- If you cannot read something, skip it rather than guessing.

Return ONLY valid JSON, no commentary, in exactly this shape:
{"messages":[{"sender":"name","text":"message text","time":"10:32 PM"}]}`;

// Longest-first, so "november" is not consumed by the "nov" alternative.
const MONTHS =
  'january|february|march|april|june|july|august|september|october|november|december' +
  '|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec';
const DAYS =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday' +
  '|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun';

/**
 * Chat apps draw date separators between messages. They are not messages, and
 * when one slips through it becomes a phantom participant in the sender picker.
 */
function isDateLike(s: string): boolean {
  const v = s.trim().toLowerCase().replace(/[,.]/g, '');
  if (!v) return true;

  return (
    /^(today|yesterday|tomorrow)$/.test(v) ||
    // 06 NOV 2024 / 6 November
    new RegExp(`^\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{2,4})?$`).test(v) ||
    // NOV 06 2024 / November 6
    new RegExp(`^(?:${MONTHS})\\s+\\d{1,2}(?:\\s+\\d{2,4})?$`).test(v) ||
    // A bare day name, exactly. "Sunny" must not match "sun".
    new RegExp(`^(?:${DAYS})$`).test(v) ||
    // Sat 3 Aug / Mon 12 Jan 2024: day name plus an actual date.
    new RegExp(
      `^(?:${DAYS})\\s+(?:\\d{1,2}\\s+(?:${MONTHS})|(?:${MONTHS})\\s+\\d{1,2})(?:\\s+\\d{2,4})?$`
    ).test(v) ||
    // 12/01/2024, 2024-01-12
    /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(v) ||
    // Bare clock time as a sender
    /^\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?$/.test(v)
  );
}

type Body = { images?: { mimeType: string; data: string }[] };

export async function POST(req: Request) {
  try {
    const { images }: Body = await req.json();

    if (!images?.length) {
      return NextResponse.json({ error: 'No images provided.' }, { status: 400 });
    }

    const parts: (TextPart | ImagePart)[] = [
      { type: 'text', text: PROMPT },
      ...images.map(
        (img): ImagePart => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        })
      ),
    ];

    const raw = await complete({
      kind: 'vision',
      models: VISION_MODELS,
      messages: [{ role: 'user', content: parts }],
      temperature: 0,
      json: true,
      maxTokens: 4096,
    });

    const parsed = parseJson<ExtractedBatch>(raw);
    const messages: ChatMessage[] = (parsed.messages ?? [])
      .filter((m) => m?.text?.trim() && m?.sender?.trim())
      .map((m) => ({
        sender: m.sender.trim(),
        text: m.text.trim(),
        time: m.time?.trim() || undefined,
      }))
      // Belt and braces: the prompt forbids date dividers, but models still
      // emit them, and one leaking through shows up as a fake participant.
      .filter((m) => !isDateLike(m.sender) && !isDateLike(m.text));

    return NextResponse.json({ messages });
  } catch (err) {
    const message = err ? explain(err) : 'Extraction failed.';
    const rateLimited = /429|quota|rate|resource_exhausted/i.test(message);
    return NextResponse.json(
      { error: message, rateLimited },
      { status: rateLimited ? 429 : 500 }
    );
  }
}
