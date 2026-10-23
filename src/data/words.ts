import type { Item } from '../decks/types';
import rawWords from './words.json';

/** Levels of the built-in word list (and the level filter). */
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Level = (typeof LEVELS)[number];
/** Items from decks or the dictionary can also be C1/C2. */
export type WordLevel = Level | 'C1' | 'C2';

/** A row of words.json. */
export interface Word {
  id: string;
  word: string;
  meaning: string;
  example: string;
  level: WordLevel;
}

/**
 * What a battle asks about: a deck item (word or phrase) plus where it came from. Built-in words
 * have a level and no deckId; items from "Bộ của tôi" carry their deck so results can update FSRS.
 */
export type BattleItem = Item & {
  level?: WordLevel;
  deckId?: string;
  /** The item's id in its deck when the battle id had to be made unique (same item in two decks). */
  sourceId?: string;
};

export const ALL_WORDS: readonly Word[] = rawWords as Word[];

export function itemFromWord(w: Word): BattleItem {
  return { id: w.id, type: 'word', text: w.word, meaning: w.meaning, examples: w.example ? [{ en: w.example, vi: '' }] : [], tags: [], level: w.level };
}

/** The built-in words as battle items (also the distractor pool for small decks). */
export const BUILTIN_ITEMS: readonly BattleItem[] = ALL_WORDS.map(itemFromWord);

const byId = new Map(BUILTIN_ITEMS.map((w) => [w.id, w]));

export function getBuiltin(id: string): BattleItem | undefined {
  return byId.get(id);
}

/** Resolve built-in ids, silently dropping ids that no longer exist. */
export function builtinFromIds(ids: readonly string[]): BattleItem[] {
  return ids.map((id) => byId.get(id)).filter((w): w is BattleItem => w !== undefined);
}

export function filterItems(items: readonly BattleItem[], level: Level | 'all', search: string): BattleItem[] {
  const q = search.trim().toLowerCase();
  return items.filter(
    (w) => (level === 'all' || w.level === level) && (q === '' || w.text.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)),
  );
}
