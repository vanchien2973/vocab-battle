import type { BattleItem } from '../data/words';
import type { ItemType } from '../decks/types';
import type { GameState, PlayerId } from '../game/types';
import { cardKey, isNew, Rating, review, type CardType, type DeckProgress, type Grade } from './fsrs';
import type { ProgressQueue } from './progressQueue';

export interface BattleReview {
  deckId: string;
  itemId: string;
  type: ItemType;
  grade: Grade;
  /** Card the result trains; battles use EN → VI. */
  cardType?: CardType;
}

/**
 * What a finished battle means for FSRS: items from the player's decks answered wrong at least once
 * are "Again", the others answered right are "Good". Built-in words and unasked items are skipped.
 */
export function battleReviews(state: GameState, player: PlayerId, items: readonly BattleItem[]): BattleReview[] {
  const p = state.players[player];
  const wrong = new Set(p.wrongItemIds);
  const right = new Set(p.rightItemIds);
  const out: BattleReview[] = [];
  for (const it of items) {
    if (!it.deckId || (!wrong.has(it.id) && !right.has(it.id))) continue;
    out.push({ deckId: it.deckId, itemId: it.sourceId ?? it.id, type: it.type, grade: wrong.has(it.id) ? Rating.Again : Rating.Good });
  }
  return out;
}

/** Apply results to their cards (EN → VI unless a review says otherwise) and flush. */
export async function applyBattleReviews(
  reviews: readonly BattleReview[],
  loadProgress: (deckId: string) => Promise<DeckProgress>,
  queue: ProgressQueue,
  now = new Date(),
): Promise<void> {
  const decks = [...new Set(reviews.map((r) => r.deckId))];
  const progress = new Map(await Promise.all(decks.map(async (d) => [d, await loadProgress(d)] as const)));
  for (const r of reviews) {
    const key = cardKey(r.itemId, r.cardType ?? 'en-vi');
    const card = progress.get(r.deckId)?.cards[key];
    await queue.record(r.deckId, key, review(card, r.grade, now), r.type, r.grade, isNew(card));
  }
  await queue.flush();
}
