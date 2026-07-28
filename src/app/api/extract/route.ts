import { NextResponse } from 'next/server';
import { getClient, VISION_MODEL, withRetry, parseJson } from '@/lib/gemini';
import type { ChatMessage, ExtractedBatch } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PROMPT = `You are reading screenshots of a chat conversation.

Transcribe EVERY message you can see, in the order they appear top to bottom, across all the images given (the images are consecutive screenshots of the same conversation).

Rules:
- Identify who sent each message. Use the contact name shown in the screenshot if there is one. If names are not visible, use "Me" for messages in bubbles aligned to the right, and "Them" for bubbles aligned to the left.
- Use the SAME sender label consistently across all images.
- Transcribe text exactly: keep original spelling, casing, slang, emoji, punctuation, and typos. Do not correct or clean anything. This is critical, because the errors and habits are the point.
- Include the visible timestamp if there is one.
- Skip UI chrome: headers, battery/wifi icons, "delivered"/"read" receipts, date dividers, typing indicators.
- If a message is an image/sticker/voice note with no text, represent it as [photo], [sticker], or [voice note].
- If you cannot read something, skip it rather than guessing.

Return ONLY valid JSON, no commentary, in exactly this shape:
{"messages":[{"sender":"name","text":"message text","time":"10:32 PM"}]}`;

type Body = { images?: { mimeType: string; data: string }[] };

export async function POST(req: Request) {
  try {
    const { images }: Body = await req.json();

    if (!images?.length) {
      return NextResponse.json({ error: 'No images provided.' }, { status: 400 });
    }

    const parts = [
      { text: PROMPT },
      ...images.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];

    const ai = getClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: VISION_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      })
    );

    const parsed = parseJson<ExtractedBatch>(res.text ?? '');
    const messages: ChatMessage[] = (parsed.messages ?? [])
      .filter((m) => m?.text?.trim() && m?.sender?.trim())
      .map((m) => ({
        sender: m.sender.trim(),
        text: m.text.trim(),
        time: m.time?.trim() || undefined,
      }));

    return NextResponse.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed.';
    const rateLimited = /429|quota|rate|resource_exhausted/i.test(message);
    return NextResponse.json(
      { error: message, rateLimited },
      { status: rateLimited ? 429 : 500 }
    );
  }
}
