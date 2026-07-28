'use client';

import { useState } from 'react';
import type { ChatMessage, StyleProfile } from '@/lib/types';

type Props = {
  transcript: ChatMessage[];
  participants: string[];
  onReady: (profile: StyleProfile) => void;
  onRestart: () => void;
};

export default function PickSender({
  transcript,
  participants,
  onReady,
  onRestart,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const counts = Object.fromEntries(
    participants.map((p) => [p, transcript.filter((m) => m.sender === p).length])
  );

  async function build(target: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, target }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not build the profile.');
      onReady(body.profile as StyleProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h2 className="text-2xl font-semibold tracking-tight">
        Read {transcript.length} messages
      </h2>
      <p className="mt-3 text-muted">Who should the AI become?</p>

      <div className="mt-8 space-y-3">
        {participants.map((p) => {
          const sample = transcript.filter((m) => m.sender === p).slice(-3);
          return (
            <button
              key={p}
              disabled={busy}
              onClick={() => build(p)}
              className="w-full rounded-xl border border-edge bg-panel p-5 text-left transition hover:border-accent disabled:opacity-50"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-medium">{p}</span>
                <span className="text-sm text-muted">{counts[p]} messages</span>
              </div>
              <div className="mt-3 space-y-1">
                {sample.map((m, i) => (
                  <p key={i} className="truncate text-sm text-muted">
                    “{m.text}”
                  </p>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {busy && (
        <p className="mt-6 text-sm text-muted">
          Studying how they write — this takes a few seconds…
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={onRestart}
        disabled={busy}
        className="mt-8 text-sm text-muted underline underline-offset-4 hover:text-slate-200 disabled:opacity-50"
      >
        Start over with different screenshots
      </button>
    </div>
  );
}
