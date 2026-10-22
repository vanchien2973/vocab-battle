import rawWords from './words.json';

export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Level = (typeof LEVELS)[number];

export interface Word {
  id: string;
  word: string;
  meaning: string;
  example: string;
  level: Level;
}

export const ALL_WORDS: readonly Word[] = rawWords as Word[];

const byId = new Map(ALL_WORDS.map((w) => [w.id, w]));

export function getWord(id: string): Word | undefined {
  return byId.get(id);
}

/** Resolve ids to words, silently dropping ids that no longer exist. */
export function wordsFromIds(ids: readonly string[]): Word[] {
  return ids.map((id) => byId.get(id)).filter((w): w is Word => w !== undefined);
}

export function filterWords(words: readonly Word[], level: Level | 'all', search: string): Word[] {
  const q = search.trim().toLowerCase();
  return words.filter(
    (w) =>
      (level === 'all' || w.level === level) &&
      (q === '' || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)),
  );
}
