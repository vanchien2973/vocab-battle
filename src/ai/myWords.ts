import type { Word } from '../data/words';
import { readJSON, writeJSON } from '../storage/safeStorage';
import { normalizeWord } from './normalize';
import { CEFR_LEVELS, type LookupEntry } from './types';

const KEY = 'vocab-battle.mywords.v1';
export const MY_PREFIX = 'my:';
export const MAX_MY_WORDS = 300;

export const isMyWord = (id: string) => id.startsWith(MY_PREFIX);

function isWord(w: unknown): w is Word {
  const x = w as Word;
  return (
    !!x &&
    typeof x.id === 'string' &&
    isMyWord(x.id) &&
    typeof x.word === 'string' &&
    typeof x.meaning === 'string' &&
    typeof x.example === 'string' &&
    CEFR_LEVELS.includes(x.level as never)
  );
}

/** Words the player saved from the dictionary ("Của tôi"). */
export function loadMyWords(): Word[] {
  const list = readJSON<unknown>(KEY, []);
  return Array.isArray(list) ? list.filter(isWord) : [];
}

/** Turn a dictionary entry into a playable word: first two distinct meanings, first example. */
export function wordFromEntry(entry: LookupEntry): Word | null {
  const key = normalizeWord(entry.word);
  const meanings = [...new Set(entry.senses.map((s) => s.meaningVi.trim()).filter(Boolean))].slice(0, 2);
  if (!key || meanings.length === 0) return null;
  return {
    id: MY_PREFIX + key,
    word: entry.word.trim(),
    meaning: meanings.join('; ').slice(0, 120),
    example: entry.examples[0]?.en.slice(0, 200) ?? '',
    level: entry.cefr,
  };
}

/** Returns the saved word, or null if the entry cannot be used. Saving the same word twice updates it. */
export function addMyWord(entry: LookupEntry): Word | null {
  const word = wordFromEntry(entry);
  if (!word) return null;
  const rest = loadMyWords().filter((w) => w.id !== word.id);
  writeJSON(KEY, [...rest, word].slice(-MAX_MY_WORDS));
  return word;
}

export function removeMyWord(id: string): void {
  writeJSON(
    KEY,
    loadMyWords().filter((w) => w.id !== id),
  );
}

export function hasMyWord(word: string): boolean {
  const key = normalizeWord(word);
  return !!key && loadMyWords().some((w) => w.id === MY_PREFIX + key);
}
