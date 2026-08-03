import { stream, TEXT_MODELS, explain } from '@/lib/llm';
import type { Msg } from '@/lib/llm';
import type { ChatMessage, StyleProfile, Turn } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STOPWORDS = new Set([
  'the', 'and', 'you', 'that', 'this', 'have', 'for', 'not', 'with', 'was',
  'are', 'but', 'what', 'your', 'can', 'about', 'they', 'from', 'just',
  'like', 'how', 'when', 'why', 'who', 'did', 'does', 'were', 'his', 'her',
  'them', 'there', 'their', 'been', 'has', 'had', 'its', 'our', 'out',
]);

/**
 * Lightweight keyword retrieval over the transcript: the no-database
 * substitute for vector RAG. Surfaces things the person actually said about
 * whatever the user just brought up, so replies can pull real phrasing.
 */
function findRelevant(
  transcript: ChatMessage[],
  target: string,
  query: string,
  limit = 12
): ChatMessage[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (!terms.length) return [];

  const theirs = transcript.filter((m) => m.sender === target);
  return theirs
    .map((m) => {
      const text = m.text.toLowerCase();
      const score = terms.reduce((n, t) => (text.includes(t) ? n + 1 : n), 0);
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

function buildSystemPrompt(
  profile: StyleProfile,
  relevant: ChatMessage[],
  recentContext: ChatMessage[]
) {
  const name = profile.displayName;
  const list = (label: string, arr: string[]) =>
    arr?.length ? `${label}: ${arr.join(' | ')}` : '';

  /**
   * Two failure modes shaped this prompt.
   *
   * Parroting: listing real messages under "match this voice precisely" made
   * the model replay them verbatim, so "hey" got answered with a line about
   * the cat. The samples are now explicitly labelled style-only, with
   * answering the actual question stated as the first rule.
   *
   * Length: small models pad. The instruction has to be concrete, so the
   * observed average word count is computed and given as a number.
   */
  const sample = profile.exemplars.length
    ? profile.exemplars
    : relevant.map((m) => m.text);

  const words =
    sample.length > 0
      ? Math.max(
          3,
          Math.round(
            sample.reduce((n, s) => n + s.trim().split(/\s+/).length, 0) / sample.length
          )
        )
      : 8;

  return `You are ${name}, replying to a text message from someone you know.

YOUR PERSONALITY AND VOICE:
${profile.voice}

Punctuation and casing: ${profile.punctuation}
${list('Topics you talk about', profile.topics)}
${list('Your quirks', profile.quirks)}
${list('Words and phrases you use', profile.signaturePhrases)}
${list('Emoji you use', profile.emoji)}

EXAMPLES OF YOUR WRITING STYLE (imitate the STYLE only, never repeat these lines):
${sample.slice(0, 10).map((e) => `- ${e}`).join('\n')}

${
  relevant.length
    ? `FOR CONTEXT, things you have said on this topic before (background only, do not repeat verbatim):\n${relevant
        .slice(0, 6)
        .map((m) => `- ${m.text}`)
        .join('\n')}\n`
    : ''
}${
    recentContext.length
      ? `RECENT CONVERSATION HISTORY:\n${recentContext
          .slice(-10)
          .map((m) => `${m.sender}: ${m.text}`)
          .join('\n')}\n`
      : ''
  }
HOW TO REPLY:
1. ANSWER THE MESSAGE YOU WERE JUST SENT. This matters most. If they ask how you are, say how you are. If they greet you, greet them back. Never reply with an unrelated line from the examples above.
2. Write a NEW sentence in your own voice. Do not copy the example messages. They show your style, not your answer.
3. Keep it to about ${words} words. Text like a person, not an essay.
4. Match your casing and punctuation exactly, including lowercase and missing apostrophes if that is your habit.
5. Write only the message text. No quotation marks, no narration, no name prefix.
6. You are ${name}, a real person. Never mention being an AI or a model.
7. If asked something you would not know, deflect or change the subject the way ${name} would.`;
}

/**
 * Models still occasionally prefix the sender name or wrap the reply in
 * quotes despite being told not to. Buffer the stream, strip those, and emit
 * the cleaned text. Replies are short enough that buffering costs nothing
 * perceptible.
 */
function cleanReply(
  src: ReadableStream<Uint8Array>,
  name: string
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const reader = src.getReader();
      const decoder = new TextDecoder();
      let text = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      let out = text.trim();

      // "Sam: hello" -> "hello"
      const prefix = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
      out = out.replace(prefix, '').trim();

      // Whole reply wrapped in quotes.
      if (out.length > 1 && /^["“'].*["”']$/s.test(out)) {
        out = out.slice(1, -1).trim();
      }

      // Stage directions like *laughs*.
      out = out.replace(/^\*[^*]+\*\s*/, '').trim();

      /**
       * Small models occasionally emit a stray token from another script
       * mid-word ("day{greek}", "{cyrillic} door"). Lowering temperature makes
       * it rarer but cannot rule it out, so drop characters outside Latin,
       * common punctuation, and emoji. Emoji are kept because they are often
       * part of the person's real style.
       */
      out = out
        .replace(
          /[^\p{Script=Latin}\p{Nd}\p{P}\p{Zs}\n\r\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
          ''
        )
        .replace(/\s{2,}/g, ' ')
        .trim();

      controller.enqueue(new TextEncoder().encode(out || '…'));
      controller.close();
    },
  });
}

type Body = {
  profile?: StyleProfile;
  transcript?: ChatMessage[];
  history?: Turn[];
  message?: string;
};

export async function POST(req: Request) {
  try {
    const { profile, transcript = [], history = [], message }: Body = await req.json();

    if (!profile || !message?.trim()) {
      return Response.json({ error: 'profile and message are required.' }, { status: 400 });
    }

    const relevant = findRelevant(transcript, profile.displayName, message);
    // A long dump of the original chat makes the model continue that
    // conversation instead of answering the new message.
    const recentContext = transcript.slice(-10);
    const system = buildSystemPrompt(profile, relevant, recentContext);

    const messages: Msg[] = [
      { role: 'system', content: system },
      ...history.slice(-20).map(
        (t): Msg => ({
          role: t.role === 'assistant' ? 'assistant' : 'user',
          content: t.content,
        })
      ),
      { role: 'user', content: message },
    ];

    const raw = await stream({
      kind: 'text',
      models: TEXT_MODELS,
      messages,
      // A 20B model emits corrupted tokens as temperature rises: 0.95 gave
      // "I told luggage" and "how's it advogado", 0.7 still gave "day{greek}"
      // and "{cyrillic} door". 0.5 keeps replies varied without the garbage.
      temperature: 0.5,
      // Texts are short. A tight cap discourages the model from padding.
      maxTokens: 160,
    });

    const body = cleanReply(raw, profile.displayName);

    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    const message = err ? explain(err) : 'Chat failed.';
    const rateLimited = /429|quota|rate|resource_exhausted/i.test(message);
    return Response.json({ error: message, rateLimited }, { status: rateLimited ? 429 : 500 });
  }
}
