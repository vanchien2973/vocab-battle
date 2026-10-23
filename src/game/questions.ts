import type { BattleItem } from '../data/words';
import { generateQuestion } from './generators';
import { shuffle, type Rng } from './rng';
import { QUESTION_KINDS, type Question, type QuestionKind } from './types';

export { OPTION_COUNT } from './generators';
/** A match needs at least this many selected items… */
export const MIN_SELECTED_WORDS = 10;
/** …except when every item comes from the player's own decks (small decks can still battle). */
export const MIN_SELECTED_OWN = 1;

export const DEFAULT_KINDS: readonly QuestionKind[] = QUESTION_KINDS;

/** Minimum selection size for these items. */
export function minSelected(items: readonly Pick<BattleItem, 'deckId'>[]): number {
  return items.length > 0 && items.every((i) => i.deckId) ? MIN_SELECTED_OWN : MIN_SELECTED_WORDS;
}

/** Remaining item ids to ask, in order. Immutable: drawing returns a new deck. */
export interface Deck {
  remaining: string[];
  lastWordId: string | null;
}

/**
 * Shuffle the selected items into a fresh deck. `avoidFirst` keeps the item that was just
 * asked from being repeated immediately when a deck is reshuffled.
 */
export function createDeck(selected: readonly BattleItem[], rng: Rng, avoidFirst: string | null = null): Deck {
  const ids = shuffle(
    selected.map((w) => w.id),
    rng,
  );
  if (avoidFirst !== null && ids.length > 1 && ids[0] === avoidFirst) {
    [ids[0], ids[ids.length - 1]] = [ids[ids.length - 1], ids[0]];
  }
  return { remaining: ids, lastWordId: avoidFirst };
}

/** A "Nghĩa" question (kept for callers that only need the classic word → meaning question). */
export function makeQuestion(item: BattleItem, pool: readonly BattleItem[], rng: Rng, seq: number): Question {
  return generateQuestion(item, ['meaning'], { pool, rng, seq });
}

/**
 * Draw the next question from the selected items only. Every selected item is asked once
 * before any repeats; when the deck runs out it is reshuffled and play continues. The question
 * kind is one of `kinds` that the item supports (fallback: Nghĩa / Cloze).
 */
export function drawQuestion(
  deck: Deck,
  selected: readonly BattleItem[],
  pool: readonly BattleItem[],
  rng: Rng,
  seq: number,
  kinds: readonly QuestionKind[] = DEFAULT_KINDS,
): { question: Question; deck: Deck } {
  if (selected.length === 0) throw new Error('No words selected');
  const byId = new Map(selected.map((w) => [w.id, w]));
  let current = deck.remaining.length > 0 ? deck : createDeck(selected, rng, deck.lastWordId);
  let [nextId, ...rest] = current.remaining;
  // Guard against ids that are not part of the selection (e.g. a stale deck).
  while (!byId.has(nextId)) {
    current = rest.length > 0 ? { ...current, remaining: rest } : createDeck(selected, rng, current.lastWordId);
    [nextId, ...rest] = current.remaining;
  }
  return {
    question: generateQuestion(byId.get(nextId)!, kinds, { pool, rng, seq }),
    deck: { remaining: rest, lastWordId: nextId },
  };
}

/** Distractor pool: built-in words plus the selected items (so small decks still get 4 options). */
export function battlePool(builtin: readonly BattleItem[], selected: readonly BattleItem[]): BattleItem[] {
  const ids = new Set(selected.map((s) => s.id));
  return [...selected, ...builtin.filter((b) => !ids.has(b.id))];
}
