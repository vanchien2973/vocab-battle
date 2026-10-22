import type { Word } from '../data/words';
import { shuffle, type Rng } from './rng';
import type { Question } from './types';

export const OPTION_COUNT = 4;

/** Remaining word ids to ask, in order. Immutable: drawing returns a new deck. */
export interface Deck {
  remaining: string[];
  lastWordId: string | null;
}

/**
 * Shuffle the selected words into a fresh deck. `avoidFirst` keeps the word that was just
 * asked from being repeated immediately when a deck is reshuffled.
 */
export function createDeck(selected: readonly Word[], rng: Rng, avoidFirst: string | null = null): Deck {
  const ids = shuffle(
    selected.map((w) => w.id),
    rng,
  );
  if (avoidFirst !== null && ids.length > 1 && ids[0] === avoidFirst) {
    [ids[0], ids[ids.length - 1]] = [ids[ids.length - 1], ids[0]];
  }
  return { remaining: ids, lastWordId: avoidFirst };
}

/**
 * Build a multiple-choice question for `word`. Distractors come from the whole `pool`
 * (not only the selected words) and never share the correct meaning.
 */
export function makeQuestion(word: Word, pool: readonly Word[], rng: Rng, seq: number): Question {
  const seen = new Set([word.meaning]);
  const distractors: string[] = [];
  for (const w of shuffle(pool, rng)) {
    if (distractors.length === OPTION_COUNT - 1) break;
    if (seen.has(w.meaning)) continue;
    seen.add(w.meaning);
    distractors.push(w.meaning);
  }
  const options = shuffle([word.meaning, ...distractors], rng);
  return {
    id: `q${seq}-${word.id}`,
    wordId: word.id,
    word: word.word,
    options,
    correctIndex: options.indexOf(word.meaning),
  };
}

/**
 * Draw the next question from the selected words only. Every selected word is asked once
 * before any repeats; when the deck runs out it is reshuffled and play continues.
 */
export function drawQuestion(
  deck: Deck,
  selected: readonly Word[],
  pool: readonly Word[],
  rng: Rng,
  seq: number,
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
    question: makeQuestion(byId.get(nextId)!, pool, rng, seq),
    deck: { remaining: rest, lastWordId: nextId },
  };
}
