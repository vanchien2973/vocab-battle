import type { ProgressBatch } from '../study/fsrs';
import type { DeckRepository, ProgressRepository } from './repository';
import type { Deck } from './types';

/**
 * Rename decks whose names clash with existing ones (case-insensitive), keeping both:
 * "Travel" → "Travel (2)", then "(3)"… Names are also unique among the incoming decks.
 */
export function resolveNameClashes<T extends { name: string }>(incoming: readonly T[], existingNames: readonly string[]): T[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return incoming.map((d) => {
    const base = d.name.trim();
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    taken.add(name.toLowerCase());
    return name === d.name ? d : { ...d, name };
  });
}

export interface SyncResult {
  copied: number;
  renamed: number;
  failed: string[];
}

/**
 * First sign-in: copy local decks (and their progress) into the account. Name clashes keep both decks
 * with a suffix. Each copied deck is removed locally only after it was saved in the cloud.
 */
export async function syncLocalToCloud(
  local: DeckRepository,
  localProgress: ProgressRepository,
  cloud: DeckRepository,
  cloudProgress: ProgressRepository,
): Promise<SyncResult> {
  const localDecks: Deck[] = [];
  for (const s of await local.list()) localDecks.push(await local.get(s.id));
  const cloudNames = (await cloud.list()).map((d) => d.name);
  const renamed = resolveNameClashes(localDecks, cloudNames);

  const result: SyncResult = { copied: 0, renamed: 0, failed: [] };
  for (const [i, deck] of renamed.entries()) {
    try {
      const saved = await cloud.create(deck);
      const p = await localProgress.get(deck.id);
      if (Object.keys(p.cards).length || Object.keys(p.days).length) {
        // Item ids are kept, so card keys stay valid even if the deck got a new id.
        const batch: ProgressBatch = { cards: p.cards, days: p.days };
        await cloudProgress.merge(saved.id, batch);
      }
      await local.remove(deck.id);
      result.copied++;
      if (deck.name !== localDecks[i].name) result.renamed++;
    } catch {
      result.failed.push(localDecks[i].name);
    }
  }
  return result;
}
