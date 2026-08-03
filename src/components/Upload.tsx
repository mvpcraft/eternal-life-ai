'use client';

import { useRef, useState } from 'react';
import { downscale, chunk, sortByName } from '@/lib/images';
import type { ChatMessage } from '@/lib/types';

const BATCH_SIZE = 4; // images per request; balances RPM against payload size
const PAUSE_MS = 3500; // ~17 req/min, under OpenRouter's 20 RPM free-tier ceiling

type Props = {
  onDone: (transcript: ChatMessage[], participants: string[]) => void;
};

export default function Upload({ onDone }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setFiles(sortByName(imgs));
    setError('');
  }

  async function run() {
    if (!files.length) return;
    setBusy(true);
    setError('');
    setDone(0);

    try {
      setStatus('Preparing images…');
      const prepared = [];
      for (const f of files) {
        prepared.push(await downscale(f));
      }

      const batches = chunk(prepared, BATCH_SIZE);
      setTotal(batches.length);

      const all: ChatMessage[] = [];
      for (let i = 0; i < batches.length; i++) {
        setStatus(`Reading screenshots, batch ${i + 1} of ${batches.length}…`);

        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: batches[i] }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 429) {
            throw new Error(
              'Hit the free-tier rate limit. Wait a minute, then upload a smaller set.'
            );
          }
          throw new Error(body.error || `Batch ${i + 1} failed.`);
        }

        const { messages } = (await res.json()) as { messages: ChatMessage[] };
        all.push(...messages);
        setDone(i + 1);

        // Throttle between batches so we stay under the requests-per-minute cap.
        if (i < batches.length - 1) {
          setStatus(`Read ${all.length} messages, pausing for rate limit…`);
          await new Promise((r) => setTimeout(r, PAUSE_MS));
        }
      }

      if (!all.length) {
        throw new Error(
          'No messages could be read. Are these screenshots of a chat conversation?'
        );
      }

      const participants = [...new Set(all.map((m) => m.sender))];
      onDone(all, participants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Eternal Life AI</h1>
      <p className="mt-3 text-muted">
        Upload screenshots of a chat. The AI studies how they write, then talks
        back the same way.
      </p>

      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) pick(e.dataTransfer.files);
        }}
        className={`mt-8 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
          busy
            ? 'cursor-not-allowed border-edge opacity-50'
            : 'border-edge hover:border-accent hover:bg-panel/50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />
        {files.length ? (
          <>
            <p className="text-lg font-medium">{files.length} screenshots ready</p>
            <p className="mt-1 text-sm text-muted">Click to choose different ones</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium">Drop screenshots here</p>
            <p className="mt-1 text-sm text-muted">or click to browse. 20 to 50 works well</p>
          </>
        )}
      </div>

      {files.length > 0 && !busy && (
        <button
          onClick={run}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-3 font-medium text-ink transition hover:opacity-90"
        >
          Study these messages
        </button>
      )}

      {busy && (
        <div className="mt-6">
          <div className="h-2 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted">{status}</p>
          <p className="mt-1 text-xs text-muted">
            Free-tier rate limits mean this takes a couple of minutes. Leave the tab open.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <p className="mt-10 text-xs text-muted">
        Screenshots are sent to OpenRouter for reading and are not stored on any
        server. The extracted conversation stays in this browser.
      </p>
    </div>
  );
}
