import rawWords from './words.json';

/** Levels of the built-in word list (and the level filter). */
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Level = (typeof LEVELS)[number];
/** Saved dictionary words can also be C1/C2. */
export type WordLevel = Level | 'C1' | 'C2';

export interface Word {
  id: string;
  word: string;
  meaning: string;
  example: string;
  level: WordLevel;
}

export const ALL_WORDS: readonly Word[] = rawWords as Word[];

const byId = new Map(ALL_WORDS.map((w) => [w.id, w]));

export function getWord(id: string): Word | undefined {
  return byId.get(id);
}

/** Resolve built-in ids to words, silently dropping ids that no longer exist. */
export function wordsFromIds(ids: readonly string[]): Word[] {
  return ids.map((id) => byId.get(id)).filter((w): w is Word => w !== undefined);
}

/** `mine` keeps only the player's saved words (ids starting with "my:"). */
export type WordFilter = Level | 'all' | 'mine';

export function filterWords(words: readonly Word[], level: WordFilter, search: string): Word[] {
  const q = search.trim().toLowerCase();
  return words.filter(
    (w) =>
      (level === 'all' || (level === 'mine' ? w.id.startsWith('my:') : w.level === level)) &&
      (q === '' || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)),
  );
}
