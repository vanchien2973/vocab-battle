import { describe, expect, it } from 'vitest';
import { BUILTIN_ITEMS as ALL_WORDS } from '../data/words';
import { createDeck, drawQuestion, makeQuestion } from './questions';
import { mulberry32 } from './rng';

const selected = ALL_WORDS.slice(0, 10);
const selectedIds = new Set(selected.map((w) => w.id));

function drawMany(n: number, seed = 1) {
  const rng = mulberry32(seed);
  let deck = createDeck(selected, rng);
  const questions = [];
  for (let i = 1; i <= n; i++) {
    const r = drawQuestion(deck, selected, ALL_WORDS, rng, i);
    deck = r.deck;
    questions.push(r.question);
  }
  return questions;
}

describe('makeQuestion', () => {
  it('has 4 unique options including the correct meaning', () => {
    const rng = mulberry32(7);
    for (const w of ALL_WORDS) {
      const q = makeQuestion(w, ALL_WORDS, rng, 1);
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options[q.correctIndex]).toBe(w.meaning);
    }
  });
});

describe('drawQuestion', () => {
  it('only asks words from the selected set', () => {
    for (const q of drawMany(35)) expect(selectedIds.has(q.itemId)).toBe(true);
  });

  it('does not repeat a word until every selected word was asked', () => {
    const qs = drawMany(10);
    expect(new Set(qs.map((q) => q.itemId)).size).toBe(10);
  });

  it('reshuffles when the deck runs out and keeps going', () => {
    const qs = drawMany(30);
    expect(qs).toHaveLength(30);
    for (const round of [qs.slice(10, 20), qs.slice(20, 30)]) {
      expect(new Set(round.map((q) => q.itemId)).size).toBe(10);
    }
    // never the same word twice in a row across a reshuffle
    for (let i = 1; i < qs.length; i++) expect(qs[i].itemId).not.toBe(qs[i - 1].itemId);
  });

  it('can draw distractors from outside the selected set', () => {
    const selectedMeanings = new Set(selected.map((w) => w.meaning));
    const outside = drawMany(30).some((q) => q.options.some((o) => !selectedMeanings.has(o)));
    expect(outside).toBe(true);
  });

  it('gives questions unique ids', () => {
    const qs = drawMany(25);
    expect(new Set(qs.map((q) => q.id)).size).toBe(25);
  });

  it('throws without selected words', () => {
    expect(() => drawQuestion({ remaining: [], lastWordId: null }, [], ALL_WORDS, mulberry32(1), 1)).toThrow();
  });
});
