import type { Persona, Turn } from './types';

/**
 * Everything lives in the browser. No database, no accounts, which is both
 * the client's constraint and, for this kind of data, the right default.
 */
const PERSONA_KEY = 'eternal.persona';
const TURNS_KEY = 'eternal.turns';

export function savePersona(p: Persona) {
  try {
    localStorage.setItem(PERSONA_KEY, JSON.stringify(p));
  } catch {
    // Quota exceeded on a very large transcript. The session still works,
    // it just won't survive a refresh.
  }
}

export function loadPersona(): Persona | null {
  try {
    const raw = localStorage.getItem(PERSONA_KEY);
    return raw ? (JSON.parse(raw) as Persona) : null;
  } catch {
    return null;
  }
}

export function saveTurns(turns: Turn[]) {
  try {
    localStorage.setItem(TURNS_KEY, JSON.stringify(turns));
  } catch {
    /* non-fatal */
  }
}

export function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(TURNS_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

export function clearAll() {
  localStorage.removeItem(PERSONA_KEY);
  localStorage.removeItem(TURNS_KEY);
}
