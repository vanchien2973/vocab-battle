import { wordsFromIds } from '../data/words';
import { readJSON, writeJSON } from './safeStorage';

const SELECTION_KEY = 'vocab-battle.selection.v1';
const NAME_KEY = 'vocab-battle.name.v1';

/** Word ids selected last time; unknown ids (e.g. removed from words.json) are dropped. */
export function loadSelection(): string[] {
  const ids = readJSON<unknown>(SELECTION_KEY, []);
  if (!Array.isArray(ids)) return [];
  return wordsFromIds(ids.filter((id): id is string => typeof id === 'string')).map((w) => w.id);
}

export function saveSelection(ids: readonly string[]): void {
  writeJSON(SELECTION_KEY, ids);
}

export function loadName(): string {
  const name = readJSON<unknown>(NAME_KEY, '');
  return typeof name === 'string' ? name : '';
}

export function saveName(name: string): void {
  writeJSON(NAME_KEY, name);
}
