import limitsJson from '../../api/Shared/limits.json';
import { CEFR_LEVELS, type Cefr } from '../ai/types';

/** Limits shared with the API (api/Shared/limits.json). */
export const LIMITS = limitsJson;

export const ITEM_TYPES = ['word', 'collocation', 'phrasal_verb', 'idiom', 'pattern'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  word: 'Từ đơn',
  collocation: 'Collocation',
  phrasal_verb: 'Phrasal verb',
  idiom: 'Idiom',
  pattern: 'Mẫu câu',
};

export interface Example {
  en: string;
  vi: string;
}

/** Pre-generated wrong answers so battles never call the AI mid-game. */
export interface Distractors {
  wrongCollocations: string[];
  wrongParticles: string[];
  wrongSentences: string[];
}

export interface Item {
  id: string;
  type: ItemType;
  text: string;
  meaning: string;
  examples: Example[];
  tags: string[];
  ipa?: string;
  partOfSpeech?: string;
  note?: string;
  /** Id of the item this one was derived from (e.g. a collocation of a word). */
  relatedTo?: string;
  distractors?: Distractors;
}

export const DECK_SCHEMA_VERSION = 2;
export const DECK_LEVELS = ['mixed', ...CEFR_LEVELS] as const;
export type DeckLevel = Cefr | 'mixed';

export interface Deck {
  id: string;
  name: string;
  description: string;
  level: DeckLevel;
  items: Item[];
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Cosmos etag of the version this copy was read from (cloud only). */
  _etag?: string;
}

/** What the deck list shows; the API returns these without items. */
export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  level: DeckLevel;
  itemCount: number;
  updatedAt: string;
}

export function summarize(deck: Deck): DeckSummary {
  const { id, name, description, level, updatedAt } = deck;
  return { id, name, description, level, updatedAt, itemCount: deck.items.length };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyItem(type: ItemType = 'word', init: Partial<Item> = {}): Item {
  return { id: newId(), type, text: '', meaning: '', examples: [], tags: [], ...init };
}

export function newDeck(name: string, init: Partial<Deck> = {}, now = new Date()): Deck {
  const ts = now.toISOString();
  return {
    id: newId(),
    name: name.slice(0, LIMITS.fieldLength.deckName),
    description: '',
    level: 'mixed',
    items: [],
    schemaVersion: DECK_SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
    ...init,
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Same type and text (case/space-insensitive) counts as a duplicate. */
export function itemKey(item: Pick<Item, 'type' | 'text'>): string {
  return `${item.type}|${norm(item.text)}`;
}

/** Ids of items that duplicate an earlier item in the list. */
export function duplicateIds(items: readonly Item[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const it of items) {
    if (!it.text.trim()) continue;
    const k = itemKey(it);
    if (seen.has(k)) dups.add(it.id);
    seen.add(k);
  }
  return dups;
}

/** Problems that would make the API reject the deck, as Vietnamese messages (empty when valid). */
export function validateDeck(deck: Deck): string[] {
  const L = LIMITS;
  const f = L.fieldLength;
  const errors: string[] = [];
  if (!deck.name.trim()) errors.push('Bộ từ cần có tên.');
  if (deck.name.length > f.deckName) errors.push(`Tên bộ tối đa ${f.deckName} ký tự.`);
  if (deck.description.length > f.deckDescription) errors.push(`Mô tả tối đa ${f.deckDescription} ký tự.`);
  if (deck.items.length > L.maxItemsPerDeck) errors.push(`Mỗi bộ tối đa ${L.maxItemsPerDeck} mục.`);
  deck.items.forEach((it, i) => {
    for (const e of validateItem(it)) errors.push(`Mục ${i + 1}: ${e}`);
  });
  return errors;
}

export function validateItem(it: Item): string[] {
  const f = LIMITS.fieldLength;
  const errors: string[] = [];
  if (!ITEM_TYPES.includes(it.type)) errors.push('Loại không hợp lệ.');
  if (!it.text.trim()) errors.push('Thiếu từ/cụm từ.');
  if (it.text.length > f.text) errors.push(`Từ/cụm từ tối đa ${f.text} ký tự.`);
  if (!it.meaning.trim()) errors.push('Thiếu nghĩa.');
  if (it.meaning.length > f.meaning) errors.push(`Nghĩa tối đa ${f.meaning} ký tự.`);
  if (it.examples.length > LIMITS.maxExamplesPerItem) errors.push(`Tối đa ${LIMITS.maxExamplesPerItem} ví dụ.`);
  if (it.examples.some((e) => e.en.length > f.example || e.vi.length > f.example)) errors.push(`Câu ví dụ tối đa ${f.example} ký tự.`);
  if ((it.note?.length ?? 0) > f.note) errors.push(`Ghi chú tối đa ${f.note} ký tự.`);
  if ((it.ipa?.length ?? 0) > f.ipa) errors.push(`IPA tối đa ${f.ipa} ký tự.`);
  if ((it.type === 'collocation' || it.type === 'phrasal_verb') && it.text.trim() && wordCount(it.text) < 2)
    errors.push(`${ITEM_TYPE_LABELS[it.type]} cần ít nhất 2 từ.`);
  if (it.distractors?.wrongParticles.length && it.type !== 'phrasal_verb') errors.push('Tiểu từ sai chỉ dùng cho phrasal verb.');
  return errors;
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
