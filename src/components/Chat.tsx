'use client';

import { useEffect, useRef, useState } from 'react';
import type { Persona, Turn } from '@/lib/types';
import { saveTurns } from '@/lib/storage';

type Props = {
  persona: Persona;
  initialTurns: Turn[];
  onRestart: () => void;
};

export default function Chat({ persona, initialTurns, onRestart }: Props) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const name = persona.profile.displayName;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    saveTurns(turns);
  }, [turns]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: persona.profile,
          transcript: persona.transcript,
          history: turns,
          message: text,
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 429
            ? 'Rate limited. Wait a moment and try again.'
            : body.error || 'No reply came back.'
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      setTurns([...next, { role: 'assistant', content: '' }]);

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setTurns([...next, { role: 'assistant', content: acc }]);
      }

      if (!acc.trim()) {
        setTurns([...next, { role: 'assistant', content: '…' }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setTurns(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col px-4">
      <header className="flex items-center justify-between border-b border-edge py-4">
        <div>
          <h2 className="font-medium">{name}</h2>
          <p className="text-xs text-muted">
            learned from {persona.transcript.length} messages
          </p>
        </div>
        <button
          onClick={onRestart}
          className="text-sm text-muted underline underline-offset-4 hover:text-slate-200"
        >
          Start over
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-6">
        {turns.length === 0 && (
          <p className="py-12 text-center text-sm text-muted">
            Say something to {name}.
          </p>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 ${
                t.role === 'user'
                  ? 'rounded-br-md bg-accent text-ink'
                  : 'rounded-bl-md bg-panel text-slate-100'
              }`}
            >
              {t.content}
            </div>
          </div>
        ))}

        {busy && turns[turns.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-panel px-4 py-3">
              <span className="dot inline-block h-2 w-2 rounded-full bg-muted" />
              <span className="dot mx-1 inline-block h-2 w-2 rounded-full bg-muted" />
              <span className="dot inline-block h-2 w-2 rounded-full bg-muted" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-t border-edge py-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Message ${name}…`}
          className="flex-1 rounded-lg border border-edge bg-panel px-4 py-3 outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-5 font-medium text-ink transition hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
