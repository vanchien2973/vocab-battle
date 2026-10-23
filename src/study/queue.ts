import type { Deck, Item } from '../decks/types';
import { canCloze } from './cloze';
import { CARD_TYPES, cardKey, dayKey, isDue, isNew, type CardType, type DayStats, type DeckProgress, type StoredCard } from './fsrs';

export interface StudyLimits {
  newPerDay: number;
  reviewsPerDay: number;
}
export const DEFAULT_LIMITS: StudyLimits = { newPerDay: 20, reviewsPerDay: 200 };

export interface StudyCard {
  deckId: string;
  item: Item;
  cardType: CardType;
  key: string;
  card?: StoredCard;
}

/** Card types an item can produce: cloze only when an example contains the item's text. */
export function cardTypesFor(item: Item, wanted: readonly CardType[] = CARD_TYPES): CardType[] {
  return wanted.filter((t) => t !== 'cloze' || canCloze(item));
}

/** Today's counters summed over all decks. */
export function todayTotals(progress: Iterable<DeckProgress | undefined>, now = new Date()): DayStats {
  const k = dayKey(now);
  const total: DayStats = { reviews: 0, again: 0, newCards: 0, byType: {} };
  for (const p of progress) {
    const d = p?.days[k];
    if (!d) continue;
    total.reviews += d.reviews;
    total.again += d.again;
    total.newCards += d.newCards;
  }
  return total;
}

export interface QueueOptions {
  limits?: StudyLimits;
  cardTypes?: readonly CardType[];
  now?: Date;
  /** Shuffle new cards (default: keep deck order). */
  shuffle?: (cards: StudyCard[]) => StudyCard[];
}

/**
 * Cards to study today across decks: due reviews first (most overdue, then most lapses), limited
 * by what is left of today's review budget, then new cards up to today's new-card budget.
 */
export function buildQueue(decks: readonly Deck[], progressByDeck: ReadonlyMap<string, DeckProgress>, opts: QueueOptions = {}): StudyCard[] {
  const now = opts.now ?? new Date();
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const done = todayTotals(progressByDeck.values(), now);
  const reviewBudget = Math.max(0, limits.reviewsPerDay - (done.reviews - done.newCards));
  const newBudget = Math.max(0, limits.newPerDay - done.newCards);

  const due: StudyCard[] = [];
  const fresh: StudyCard[] = [];
  for (const deck of decks) {
    const p = progressByDeck.get(deck.id);
    for (const item of deck.items) {
      if (!item.text.trim() || !item.meaning.trim()) continue;
      for (const cardType of cardTypesFor(item, opts.cardTypes)) {
        const key = cardKey(item.id, cardType);
        const card = p?.cards[key];
        const sc: StudyCard = { deckId: deck.id, item, cardType, key, card };
        if (isNew(card)) fresh.push(sc);
        else if (isDue(card!, now)) due.push(sc);
      }
    }
  }
  due.sort((a, b) => a.card!.due.localeCompare(b.card!.due) || b.card!.lapses - a.card!.lapses);
  const newCards = (opts.shuffle ?? ((x) => x))(fresh).slice(0, newBudget);
  return [...due.slice(0, reviewBudget), ...newCards];
}

/** Number of due review cards per deck (for badges), ignoring daily limits. */
export function dueCount(deck: Deck, progress: DeckProgress | undefined, now = new Date()): number {
  if (!progress) return 0;
  const ids = new Set(deck.items.map((i) => i.id));
  let n = 0;
  for (const [k, c] of Object.entries(progress.cards)) {
    if (ids.has(k.slice(0, k.lastIndexOf('|'))) && isDue(c, now)) n++;
  }
  return n;
}

export interface Stats {
  due: number;
  streak: number;
  /** Oldest first, ending today. */
  last7: { day: string; reviews: number; again: number }[];
  /** Share of answers that were not "Again", per item type. */
  retentionByType: { type: Item['type']; reviews: number; rate: number }[];
}

export function computeStats(decks: readonly Deck[], progressByDeck: ReadonlyMap<string, DeckProgress>, now = new Date()): Stats {
  const days = new Map<string, DayStats>();
  for (const p of progressByDeck.values()) {
    for (const [k, d] of Object.entries(p.days)) {
      const cur = days.get(k) ?? { reviews: 0, again: 0, newCards: 0, byType: {} };
      cur.reviews += d.reviews;
      cur.again += d.again;
      for (const [t, [n, ok]] of Object.entries(d.byType) as [Item['type'], [number, number]][]) {
        const [n0, ok0] = cur.byType[t] ?? [0, 0];
        cur.byType[t] = [n0 + n, ok0 + ok];
      }
      days.set(k, cur);
    }
  }
  const dayAt = (offset: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));

  // Streak: consecutive days with reviews, ending today (or yesterday if today is not done yet).
  let streak = 0;
  let offset = (days.get(dayAt(0))?.reviews ?? 0) > 0 ? 0 : 1;
  while ((days.get(dayAt(offset))?.reviews ?? 0) > 0) {
    streak++;
    offset++;
  }

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const k = dayAt(6 - i);
    const d = days.get(k);
    return { day: k, reviews: d?.reviews ?? 0, again: d?.again ?? 0 };
  });

  const byType = new Map<Item['type'], [number, number]>();
  for (const d of days.values()) {
    for (const [t, [n, ok]] of Object.entries(d.byType) as [Item['type'], [number, number]][]) {
      const [n0, ok0] = byType.get(t) ?? [0, 0];
      byType.set(t, [n0 + n, ok0 + ok]);
    }
  }
  const retentionByType = [...byType].map(([type, [n, ok]]) => ({ type, reviews: n, rate: n ? ok / n : 0 }));

  const due = decks.reduce((sum, d) => sum + dueCount(d, progressByDeck.get(d.id), now), 0);
  return { due, streak, last7, retentionByType };
}
