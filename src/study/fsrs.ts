import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { Deck, ItemType } from '../decks/types';

export const CARD_TYPES = ['en-vi', 'vi-en', 'cloze', 'listen'] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  'en-vi': 'EN → VI',
  'vi-en': 'VI → EN',
  cloze: 'Điền chỗ trống',
  listen: 'Nghe',
};

export { Rating };
export type { Grade };
export const GRADES: readonly Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/** ts-fsrs Card as stored (JSON-safe: dates as ISO strings). */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: string;
}

/** Per-day counters for statistics; byType holds [reviews, remembered] per item type. */
export interface DayStats {
  reviews: number;
  again: number;
  newCards: number;
  byType: Partial<Record<ItemType, [number, number]>>;
}

/** One finished Luyện Gõ game (kept in the "_typing" progress document). */
export interface TypingSession {
  at: string;
  score: number;
  wpm: number;
  accuracy: number;
  milestone: number;
  content: 'copy' | 'meaning' | 'listen' | 'cloze';
  mode: 'solo' | 'bot' | 'online';
}

export const TYPING_PROGRESS_ID = '_typing';
export const MAX_TYPING_SESSIONS = 100;

/** Progress of one deck: FSRS state per itemId|cardType plus daily stats. */
export interface DeckProgress {
  deckId: string;
  cards: Record<string, StoredCard>;
  days: Record<string, DayStats>;
  /** Only in the "_typing" document. */
  typing?: TypingSession[];
  updatedAt: string;
  _etag?: string;
}

/** A batch written after a session (or every 10 cards): latest card states plus day deltas. */
export interface ProgressBatch {
  cards: Record<string, StoredCard>;
  days: Record<string, DayStats>;
  typing?: TypingSession[];
}

export const KEEP_DAYS = 60;
const scheduler = fsrs({ enable_fuzz: false });

export const cardKey = (itemId: string, type: CardType) => `${itemId}|${type}`;
export const itemIdOfKey = (key: string) => key.slice(0, key.lastIndexOf('|'));

export function emptyProgress(deckId: string): DeckProgress {
  return { deckId, cards: {}, days: {}, updatedAt: new Date(0).toISOString() };
}

function toCard(s: StoredCard): Card {
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
    elapsed_days: 0,
  };
}

function fromCard(c: Card): StoredCard {
  const s: StoredCard = {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
  };
  if (c.last_review) s.last_review = c.last_review.toISOString();
  return s;
}

export function newCard(now = new Date()): StoredCard {
  return fromCard(createEmptyCard(now));
}

/** Schedule the next review after answering with `grade`. */
export function review(card: StoredCard | undefined, grade: Grade, now = new Date()): StoredCard {
  return fromCard(scheduler.next(toCard(card ?? newCard(now)), now, grade).card);
}

/** Interval preview for the four buttons, e.g. "10 phút", "3 ngày". */
export function previewIntervals(card: StoredCard | undefined, now = new Date()): Record<Grade, string> {
  const log = scheduler.repeat(toCard(card ?? newCard(now)), now);
  const out = {} as Record<Grade, string>;
  for (const g of GRADES) out[g] = formatInterval(log[g].card.due.getTime() - now.getTime());
  return out;
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} phút`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} giờ`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} ngày`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo} tháng` : `${(d / 365).toFixed(1)} năm`;
}

export const isNew = (c: StoredCard | undefined) => !c || c.state === State.New;
export const isDue = (c: StoredCard, now = new Date()) => c.state !== State.New && new Date(c.due).getTime() <= now.getTime();

/**
 * Estimate an FSRS card from old Leitner progress (box 1–5, last review time). Higher boxes
 * mean longer remembered: stability 1/3/7/14/30 days, due one interval after the last review.
 */
export function leitnerToFsrs(box: number, lastReviewed: string | number | Date, wrongCount = 0): StoredCard {
  const intervals = [1, 3, 7, 14, 30];
  const b = Math.min(Math.max(Math.round(box), 1), intervals.length);
  const days = intervals[b - 1];
  const last = new Date(lastReviewed);
  const lastValid = Number.isNaN(last.getTime()) ? new Date() : last;
  return {
    due: new Date(lastValid.getTime() + days * 86_400_000).toISOString(),
    stability: days,
    // Frequently wrong words are harder (FSRS difficulty is 1–10).
    difficulty: Math.min(10, 5 + wrongCount * 0.5 - (b - 1) * 0.5),
    scheduled_days: days,
    learning_steps: 0,
    reps: b,
    lapses: Math.max(0, Math.round(wrongCount)),
    state: State.Review,
    last_review: lastValid.toISOString(),
  };
}

/** Local calendar day (YYYY-MM-DD); daily limits and streaks follow the player's own day. */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyDay(): DayStats {
  return { reviews: 0, again: 0, newCards: 0, byType: {} };
}

/** Add one answer to a day's counters (returns a new object). */
export function countReview(day: DayStats | undefined, itemType: ItemType, grade: Grade, wasNew: boolean): DayStats {
  const d = day ?? emptyDay();
  const [n, ok] = d.byType[itemType] ?? [0, 0];
  return {
    reviews: d.reviews + 1,
    again: d.again + (grade === Rating.Again ? 1 : 0),
    newCards: d.newCards + (wasNew ? 1 : 0),
    byType: { ...d.byType, [itemType]: [n + 1, ok + (grade === Rating.Again ? 0 : 1)] },
  };
}

export function addDays(a: DayStats | undefined, b: DayStats): DayStats {
  const out = { ...(a ?? emptyDay()), byType: { ...(a?.byType ?? {}) } };
  out.reviews += b.reviews;
  out.again += b.again;
  out.newCards += b.newCards;
  for (const [t, [n, ok]] of Object.entries(b.byType) as [ItemType, [number, number]][]) {
    const [n0, ok0] = out.byType[t] ?? [0, 0];
    out.byType[t] = [n0 + n, ok0 + ok];
  }
  return out;
}

/**
 * Apply a batch to stored progress, the same way the API does: a card is replaced only by a
 * newer review, day counters are added, and days older than KEEP_DAYS are dropped.
 */
export function mergeProgress(p: DeckProgress, batch: ProgressBatch, now = new Date()): DeckProgress {
  const cards = { ...p.cards };
  for (const [k, c] of Object.entries(batch.cards)) {
    const cur = cards[k];
    if (!cur || (c.last_review ?? '') >= (cur.last_review ?? '')) cards[k] = c;
  }
  const days = { ...p.days };
  for (const [k, d] of Object.entries(batch.days)) days[k] = addDays(days[k], d);
  const cutoff = dayKey(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  const merged: DeckProgress = { ...p, cards, days, updatedAt: now.toISOString() };
  if (batch.typing?.length) merged.typing = mergeTypingSessions(p.typing ?? [], batch.typing);
  return merged;
}

/** Append sessions (no duplicates by time), keep the newest 100, oldest first. */
export function mergeTypingSessions(existing: readonly TypingSession[], incoming: readonly TypingSession[]): TypingSession[] {
  const byAt = new Map(existing.map((s) => [s.at, s]));
  for (const s of incoming) byAt.set(s.at, s);
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_TYPING_SESSIONS);
}

/** Share of a deck's items with at least one card that graduated to review (stability ≥ 1 day). */
export function learnedPercent(deck: Pick<Deck, 'items'>, progress: DeckProgress | undefined): number {
  if (!deck.items.length || !progress) return 0;
  const learned = new Set<string>();
  for (const [k, c] of Object.entries(progress.cards)) {
    if (c.state === State.Review && c.stability >= 1) learned.add(itemIdOfKey(k));
  }
  const n = deck.items.filter((it) => learned.has(it.id)).length;
  return Math.round((n / deck.items.length) * 100);
}
