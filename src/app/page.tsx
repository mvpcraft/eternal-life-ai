'use client';

import { useEffect, useState } from 'react';
import Upload from '@/components/Upload';
import PickSender from '@/components/PickSender';
import Chat from '@/components/Chat';
import { loadPersona, savePersona, loadTurns, clearAll } from '@/lib/storage';
import type { ChatMessage, Persona, StyleProfile, Turn } from '@/lib/types';

type Stage =
  | { name: 'loading' }
  | { name: 'upload' }
  | { name: 'pick'; transcript: ChatMessage[]; participants: string[] }
  | { name: 'chat'; persona: Persona; turns: Turn[] };

export default function Home() {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });

  // Resume a previous session if one is in this browser.
  useEffect(() => {
    const persona = loadPersona();
    setStage(
      persona
        ? { name: 'chat', persona, turns: loadTurns() }
        : { name: 'upload' }
    );
  }, []);

  function restart() {
    clearAll();
    setStage({ name: 'upload' });
  }

  if (stage.name === 'loading') {
    return <div className="p-16 text-sm text-muted">Loading…</div>;
  }

  if (stage.name === 'upload') {
    return (
      <Upload
        onDone={(transcript, participants) =>
          setStage({ name: 'pick', transcript, participants })
        }
      />
    );
  }

  if (stage.name === 'pick') {
    return (
      <PickSender
        transcript={stage.transcript}
        participants={stage.participants}
        onRestart={restart}
        onReady={(profile: StyleProfile) => {
          const persona: Persona = {
            profile,
            transcript: stage.transcript,
            participants: stage.participants,
            createdAt: Date.now(),
          };
          savePersona(persona);
          setStage({ name: 'chat', persona, turns: [] });
        }}
      />
    );
  }

  return (
    <Chat persona={stage.persona} initialTurns={stage.turns} onRestart={restart} />
  );
}
