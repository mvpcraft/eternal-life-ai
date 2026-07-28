import { NextResponse } from 'next/server';
import { getClient, CHAT_MODEL, withRetry, parseJson } from '@/lib/gemini';
import type { ChatMessage, StyleProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * This is the "training" step from the user's point of view. There is no
 * fine-tuning — we distil the person's writing style into a structured profile
 * that gets injected into the chat system prompt on every turn.
 */
function buildPrompt(target: string, lines: string) {
  return `Below is a real chat transcript. Study how "${target}" writes, and build a style profile precise enough that another writer could imitate them convincingly.

Pay attention to:
- casing habits (do they capitalise? all lowercase?)
- punctuation habits (periods? ellipses? excessive "!!"? none at all?)
- typical message length, and whether they send several short messages in a row
- exact words, slang, and filler they repeat
- emoji use, and which ones
- how they open and close conversations
- recurring topics and running jokes
- tone: warm, blunt, sarcastic, anxious, teasing
- typos and grammatical habits they repeat — DO NOT correct these, they are part of the voice

For "exemplars", copy 8-15 of their most characteristic messages VERBATIM, exactly as written.

Return ONLY valid JSON in exactly this shape:
{
  "displayName": "${target}",
  "voice": "2-4 sentence description of how they write",
  "signaturePhrases": ["..."],
  "openers": ["..."],
  "closers": ["..."],
  "emoji": ["..."],
  "punctuation": "description of punctuation and casing habits",
  "messageLength": "description of typical length and bursting habits",
  "topics": ["..."],
  "quirks": ["..."],
  "exemplars": ["verbatim message", "..."]
}

TRANSCRIPT:
${lines}`;
}

type Body = { transcript?: ChatMessage[]; target?: string };

export async function POST(req: Request) {
  try {
    const { transcript, target }: Body = await req.json();

    if (!transcript?.length || !target) {
      return NextResponse.json(
        { error: 'transcript and target are required.' },
        { status: 400 }
      );
    }

    const targetCount = transcript.filter((m) => m.sender === target).length;
    if (targetCount < 5) {
      return NextResponse.json(
        {
          error: `Only ${targetCount} message(s) found from "${target}". Upload more screenshots for a usable style profile.`,
        },
        { status: 400 }
      );
    }

    // Keep the most recent slice — enough signal, well under the context limit.
    const lines = transcript
      .slice(-600)
      .map((m) => `${m.sender}: ${m.text}`)
      .join('\n');

    const ai = getClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: CHAT_MODEL,
        contents: [{ role: 'user', parts: [{ text: buildPrompt(target, lines) }] }],
        config: { temperature: 0.3, responseMimeType: 'application/json' },
      })
    );

    const profile = parseJson<StyleProfile>(res.text ?? '');
    profile.displayName = target;

    // Guarantee array fields exist so the UI and prompt builder can trust them.
    for (const key of [
      'signaturePhrases',
      'openers',
      'closers',
      'emoji',
      'topics',
      'quirks',
      'exemplars',
    ] as const) {
      if (!Array.isArray(profile[key])) profile[key] = [];
    }

    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Profile build failed.';
    const rateLimited = /429|quota|rate|resource_exhausted/i.test(message);
    return NextResponse.json(
      { error: message, rateLimited },
      { status: rateLimited ? 429 : 500 }
    );
  }
}
