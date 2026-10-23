import type { BattleItem } from '../data/words';
import type { ContentKind } from '../typing/types';
import { readJSON, writeJSON } from './safeStorage';

const KEY = 'vocab-battle.typing.best.v1';

interface Best {
  score: number;
  wpm: number;
}

/** Solo high scores are kept per word set (decks played, or the built-in list) and content kind. */
export function typingScoreKey(items: readonly BattleItem[], content: ContentKind): string {
  const sets = new Set(items.map((i) => i.deckId ?? 'builtin'));
  return `${[...sets].sort().join(',')}|${content}`;
}

export function loadTypingBest(key: string): Best | null {
  const all = readJSON<Record<string, Best>>(KEY, {});
  const b = all?.[key];
  return b && typeof b.score === 'number' ? b : null;
}

/** Save if better; returns the best score and whether this one is new. */
export function recordTypingScore(key: string, score: number, wpm: number): { score: number; isNew: boolean } {
  const all = readJSON<Record<string, Best>>(KEY, {});
  const prev = all?.[key];
  if (prev && prev.score >= score) return { score: prev.score, isNew: false };
  writeJSON(KEY, { ...(all ?? {}), [key]: { score, wpm } });
  return { score, isNew: score > 0 };
}
