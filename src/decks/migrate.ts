import { CEFR_LEVELS } from '../ai/types';
import { readJSON, removeKey } from '../storage/safeStorage';
import { DECK_SCHEMA_VERSION, ITEM_TYPES, LIMITS, newDeck, newId, type Deck, type DeckLevel, type Example, type Item } from './types';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, maxItems).map((x) => x.slice(0, maxLen)) : [];

/** A v1 word ({word, meaning, example, ipa, note}) as a "word" item. */
export function itemFromV1Word(w: Record<string, unknown>): Item {
  const f = LIMITS.fieldLength;
  const example = str(w.example, f.example).trim();
  return dropUndefined({
    id: optStr(w.id, f.id) ?? newId(),
    type: 'word',
    text: str(w.word, f.text),
    meaning: str(w.meaning, f.meaning),
    examples: example ? [{ en: example, vi: '' }] : [],
    tags: [],
    ipa: optStr(w.ipa, f.ipa),
    note: optStr(w.note, f.note),
  });
}

/** Clean an item from storage or the network; unknown types become "word". */
export function sanitizeItem(raw: Record<string, unknown>): Item {
  const f = LIMITS.fieldLength;
  const type = ITEM_TYPES.includes(raw.type as never) ? (raw.type as Item['type']) : 'word';
  const examples: Example[] = Array.isArray(raw.examples)
    ? raw.examples
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({ en: str(e.en, f.example), vi: str(e.vi, f.example) }))
        .filter((e) => e.en.trim() !== '')
        .slice(0, LIMITS.maxExamplesPerItem)
    : [];
  const d = raw.distractors as Record<string, unknown> | undefined;
  const n = LIMITS.maxDistractorsPerList;
  const distractors =
    d && typeof d === 'object'
      ? {
          wrongCollocations: strList(d.wrongCollocations, n, f.text),
          wrongParticles: strList(d.wrongParticles, n, 20),
          wrongSentences: strList(d.wrongSentences, n, f.example),
        }
      : undefined;
  return dropUndefined({
    id: optStr(raw.id, f.id) ?? newId(),
    type,
    text: str(raw.text, f.text),
    meaning: str(raw.meaning, f.meaning),
    examples,
    tags: strList(raw.tags, LIMITS.maxTagsPerItem, f.tag),
    ipa: optStr(raw.ipa, f.ipa),
    partOfSpeech: optStr(raw.partOfSpeech, f.partOfSpeech),
    note: optStr(raw.note, f.note),
    relatedTo: optStr(raw.relatedTo, f.id),
    distractors,
  });
}

/**
 * Upgrade a stored deck to the current schema: v1 `words[]` become `items[]` of type "word"
 * (`example` → `examples[0]`). Already-current decks are sanitized and returned.
 */
export function migrateDeck(raw: Record<string, unknown>): Deck {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const rawItems = version < 2 ? raw.words : raw.items;
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => (version < 2 ? itemFromV1Word(x) : sanitizeItem(x)))
    .slice(0, LIMITS.maxItemsPerDeck);
  const now = new Date().toISOString();
  const level = (['mixed', ...CEFR_LEVELS] as string[]).includes(raw.level as string) ? (raw.level as DeckLevel) : 'mixed';
  return dropUndefined({
    id: optStr(raw.id, LIMITS.fieldLength.id) ?? newId(),
    name: str(raw.name, LIMITS.fieldLength.deckName) || 'Bộ từ',
    description: str(raw.description, LIMITS.fieldLength.deckDescription),
    level,
    items,
    schemaVersion: DECK_SCHEMA_VERSION,
    createdAt: optStr(raw.createdAt, 40) ?? now,
    updatedAt: optStr(raw.updatedAt, 40) ?? now,
    _etag: optStr(raw._etag, 100),
  });
}

export const MY_WORDS_KEY = 'vocab-battle.mywords.v1';
export const MY_WORDS_DECK_NAME = 'Của tôi';

/**
 * The old dictionary "Của tôi" list (localStorage) as a deck named "Của tôi", or null when
 * there is nothing to migrate. Item ids keep the old "my:<word>" ids so saved selections still work.
 */
export function deckFromMyWords(list: unknown): Deck | null {
  if (!Array.isArray(list)) return null;
  const items = list
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && typeof w.word === 'string' && typeof w.meaning === 'string')
    .map(itemFromV1Word)
    .filter((it) => it.text.trim() && it.meaning.trim())
    .slice(0, LIMITS.maxItemsPerDeck);
  if (items.length === 0) return null;
  return newDeck(MY_WORDS_DECK_NAME, { items, description: 'Từ đã lưu từ từ điển AI' });
}

/** Read and remove the old "Của tôi" list. Call once the returned deck has been stored. */
export function takeLegacyMyWords(): { deck: Deck | null; clear: () => void } {
  return { deck: deckFromMyWords(readJSON<unknown>(MY_WORDS_KEY, [])), clear: () => removeKey(MY_WORDS_KEY) };
}

function dropUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
