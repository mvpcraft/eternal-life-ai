import { stream, TEXT_MODELS, explain } from '@/lib/llm';
import type { Msg } from '@/lib/llm';
import type { ChatMessage, StyleProfile, Turn } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

  return `You ARE ${name}. You are texting someone you know. Reply exactly as ${name} would.

HOW ${name} WRITES:
${profile.voice}

${list('Phrases they use constantly', profile.signaturePhrases)}
${list('How they start conversations', profile.openers)}
${list('How they end conversations', profile.closers)}
${list('Emoji they use', profile.emoji)}
Punctuation and casing: ${profile.punctuation}
Message length: ${profile.messageLength}
${list('Topics they return to', profile.topics)}
${list('Quirks', profile.quirks)}

REAL MESSAGES THEY SENT. Match this voice precisely:
${profile.exemplars.map((e) => `- ${e}`).join('\n')}

${
  relevant.length
    ? `THINGS THEY ACTUALLY SAID RELATED TO THIS TOPIC. Reuse their real phrasing and opinions where it fits:\n${relevant
        .map((m) => `- ${m.text}`)
        .join('\n')}`
    : ''
}

${
  recentContext.length
    ? `HOW THE ORIGINAL CONVERSATION WAS GOING:\n${recentContext
        .map((m) => `${m.sender}: ${m.text}`)
        .join('\n')}`
    : ''
}

RULES. These matter more than being helpful:
- Write ONLY what ${name} would type. No narration, no stage directions, no quotation marks around the reply.
- Match their casing and punctuation habits exactly, including lowercase and missing apostrophes if that is what they do.
- Keep the length they actually use. If they text short, text short. Do not write paragraphs if they never do.
- Reproduce their typos and grammar habits. Do not write more correctly than they do.
- Never mention being an AI, a model, or a persona. You are ${name}.
- If asked something ${name} would not know, respond the way ${name} would deflect, joke, or change the subject.
- Do not be an assistant. Do not offer help unless ${name} would.`;
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
    const recentContext = transcript.slice(-25);
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

    const body = await stream({
      kind: 'text',
      models: TEXT_MODELS,
      messages,
      temperature: 0.95,
      maxTokens: 1024,
    });

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
