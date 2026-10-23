import type { GeneratedItem } from '../ai/tasks';
import type { AiClient, LookupEntry } from '../ai/types';
import { emptyItem, itemKey, LIMITS, type Item, type ItemType } from './types';

/** Item types whose battle questions use pre-generated wrong options. */
export const NEEDS_DISTRACTORS: readonly ItemType[] = ['collocation', 'phrasal_verb', 'idiom'];

export const needsDistractors = (it: Item) => NEEDS_DISTRACTORS.includes(it.type) && !it.distractors && it.text.trim() !== '' && it.meaning.trim() !== '';

/**
 * Generate battle distractors for phrase items that have none (10 per AI call). Failures are ignored:
 * battles fall back to other question types, and the next save tries again.
 */
export async function fillDistractors(items: Item[], ai: Pick<AiClient, 'generateDistractors'>, signal?: AbortSignal): Promise<Item[]> {
  const todo = items.filter(needsDistractors);
  if (todo.length === 0) return items;
  const byId = new Map<string, Item>();
  for (let i = 0; i < todo.length; i += 10) {
    const chunk = todo.slice(i, i + 10);
    try {
      const results = await ai.generateDistractors(
        chunk.map((it) => ({ type: it.type, text: it.text, meaning: it.meaning })),
        signal,
      );
      chunk.forEach((it, j) => {
        const r = results[j];
        if (r) byId.set(it.id, { ...it, distractors: { wrongCollocations: r.wrongCollocations, wrongParticles: r.wrongParticles, wrongSentences: r.wrongSentences } });
      });
    } catch {
      break;
    }
  }
  return items.map((it) => byId.get(it.id) ?? it);
}

/** A dictionary entry as a deck item (type from the lookup: word, collocation, phrasal verb…). */
export function itemFromEntry(entry: LookupEntry, relatedTo?: string): Item {
  const f = LIMITS.fieldLength;
  const meanings = [...new Set(entry.senses.map((s) => s.meaningVi.trim()).filter(Boolean))].slice(0, 2);
  const item = emptyItem(entry.itemType ?? (entry.word.trim().includes(' ') ? 'collocation' : 'word'), {
    text: entry.word.trim().slice(0, f.text),
    meaning: meanings.join('; ').slice(0, f.meaning),
    examples: entry.examples.slice(0, 2).map((e) => ({ en: e.en.slice(0, f.example), vi: e.vi.slice(0, f.example) })),
  });
  if (entry.ipa && item.type === 'word') item.ipa = entry.ipa.slice(0, f.ipa);
  const pos = entry.senses[0]?.partOfSpeech;
  if (pos) item.partOfSpeech = pos.slice(0, f.partOfSpeech);
  if (relatedTo) item.relatedTo = relatedTo;
  return item;
}

/** Turn AI-generated items into deck items (new ids). */
export const withIds = (items: readonly GeneratedItem[], relatedTo?: string): Item[] =>
  items.map((it) => emptyItem(it.type, { ...it, ...(relatedTo ? { relatedTo } : {}) }));

/**
 * Append items to a deck's list, skipping ones that are already there (same type and text).
 * Returns the new list and how many were added; respects the per-deck limit.
 */
export function appendItems(existing: readonly Item[], incoming: readonly Item[]): { items: Item[]; added: number; skipped: number } {
  const keys = new Set(existing.map(itemKey));
  const items = [...existing];
  let skipped = 0;
  for (const it of incoming) {
    if (keys.has(itemKey(it)) || items.length >= LIMITS.maxItemsPerDeck) {
      skipped++;
      continue;
    }
    keys.add(itemKey(it));
    items.push(it);
  }
  return { items, added: items.length - existing.length, skipped };
}
