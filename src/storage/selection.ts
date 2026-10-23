import { BUILTIN_ITEMS, type BattleItem } from '../data/words';
import type { Deck } from '../decks/types';
import { DEFAULT_KINDS } from '../game/questions';
import { QUESTION_KINDS, type QuestionKind } from '../game/types';
import { readJSON, writeJSON } from './safeStorage';

const SELECTION_KEY = 'vocab-battle.selection.v2';
const PRACTICE_KEY = 'vocab-battle.practice.v1';
const NAME_KEY = 'vocab-battle.name.v1';

/**
 * Step 1 of "Chuẩn bị". Keys are built-in word ids, or "deckId|itemId" for items of the player's
 * decks; deckIds are the decks opened in the "Bộ của tôi" tab.
 */
export interface Selection {
  keys: string[];
  deckIds: string[];
  kinds: QuestionKind[];
}

export const deckItemKey = (deckId: string, itemId: string) => `${deckId}|${itemId}`;

export function loadSelection(): Selection {
  const raw = readJSON<Partial<Selection>>(SELECTION_KEY, {});
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const kinds = strings(raw.kinds).filter((k): k is QuestionKind => QUESTION_KINDS.includes(k as QuestionKind));
  return { keys: strings(raw.keys), deckIds: strings(raw.deckIds), kinds: kinds.length ? kinds : [...DEFAULT_KINDS] };
}

export function saveSelection(sel: Selection): void {
  writeJSON(SELECTION_KEY, sel);
}

/**
 * Selected keys as battle items, in selection order. Unknown keys are dropped. Items of the same
 * id from two decks get a unique battle id (sourceId keeps the deck item id for FSRS).
 */
export function resolveSelection(keys: readonly string[], decks: readonly Deck[]): BattleItem[] {
  const builtin = new Map(BUILTIN_ITEMS.map((w) => [w.id, w]));
  const deckItems = new Map<string, BattleItem>();
  for (const d of decks) for (const it of d.items) deckItems.set(deckItemKey(d.id, it.id), { ...it, deckId: d.id });
  const used = new Set<string>();
  const out: BattleItem[] = [];
  for (const key of new Set(keys)) {
    const item = key.includes('|') ? deckItems.get(key) : builtin.get(key);
    if (!item || !item.text.trim() || !item.meaning.trim()) continue;
    let id = item.id;
    for (let n = 2; used.has(id); n++) id = `${item.id.slice(0, 58)}~${n}`;
    used.add(id);
    out.push(id === item.id ? item : { ...item, id, sourceId: item.id });
  }
  return out;
}

/** Words/phrases for the tutor's "Luyện từ đã chọn" mode (last set taken to the preview). */
export function savePracticeWords(items: readonly BattleItem[]): void {
  writeJSON(
    PRACTICE_KEY,
    items.slice(0, 50).map((i) => ({ word: i.text, meaning: i.meaning, type: i.type })),
  );
}

export function loadPracticeWords(): { word: string; meaning: string; type: string }[] {
  const list = readJSON<unknown>(PRACTICE_KEY, []);
  return Array.isArray(list)
    ? list.filter((w): w is { word: string; meaning: string; type: string } => !!w && typeof w.word === 'string' && typeof w.meaning === 'string')
    : [];
}

export function loadName(): string {
  const name = readJSON<unknown>(NAME_KEY, '');
  return typeof name === 'string' ? name : '';
}

export function saveName(name: string): void {
  writeJSON(NAME_KEY, name);
}
