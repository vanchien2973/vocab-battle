import { describe, expect, it } from 'vitest';
import { BUILTIN_ITEMS, type BattleItem } from '../data/words';
import { emptyItem } from '../decks/types';
import { initGame, resolveRound, startRound } from './engine';
import {
  clozeGenerator,
  collocationGenerator,
  collocationParts,
  errorSpotGenerator,
  generateQuestion,
  idiomContextGenerator,
  meaningGenerator,
  particleGenerator,
  pickDistractors,
  type GenContext,
} from './generators';
import { battlePool, minSelected } from './questions';
import { mulberry32 } from './rng';
import { battleReviews } from '../study/battleProgress';
import { Rating } from '../study/fsrs';

const item = (type: BattleItem['type'], text: string, init: Partial<BattleItem> = {}): BattleItem => emptyItem(type, { text, meaning: `nghĩa ${text}`, ...init });

const lookInto = item('phrasal_verb', 'look into', {
  examples: [{ en: 'The police looked into the case.', vi: 'Cảnh sát đã điều tra vụ án.' }],
  distractors: { wrongCollocations: [], wrongParticles: ['at', 'after'], wrongSentences: ['The police looked at into the case.'] },
});
const makeDecision = item('collocation', 'make a decision', {
  examples: [{ en: 'She made a decision quickly.', vi: 'Cô ấy quyết định nhanh.' }],
  distractors: { wrongCollocations: ['do a decision', 'take a decision', 'have a decision'], wrongParticles: [], wrongSentences: ['I did a decision yesterday.'] },
});
const heavyRain = item('collocation', 'heavy rain', {
  examples: [{ en: 'Heavy rain fell all night.', vi: 'Mưa to suốt đêm.' }],
  distractors: { wrongCollocations: ['strong rain', 'big rain'], wrongParticles: [], wrongSentences: [] },
});
const breakIce = item('idiom', 'break the ice', { examples: [{ en: 'A joke can break the ice.', vi: 'Một câu đùa giúp mọi người bớt ngại khi mới gặp.' }] });
const idioms = ['piece of cake', 'hit the books', 'under the weather'].map((t) => item('idiom', t, { examples: [{ en: `It is ${t}.`, vi: 'x' }] }));
const runWord = item('word', 'run', { examples: [{ en: 'I run every day.', vi: '' }] });

const pool: BattleItem[] = battlePool(BUILTIN_ITEMS, [lookInto, makeDecision, heavyRain, breakIce, ...idioms, runWord]);
const ctx = (seed = 1): GenContext => ({ pool, rng: mulberry32(seed), seq: 1 });

function valid(q: ReturnType<typeof generateQuestion> | null) {
  expect(q).not.toBeNull();
  expect(q!.options).toHaveLength(4);
  expect(new Set(q!.options.map((o) => o.toLowerCase())).size).toBe(4);
  expect(q!.correctIndex).toBeGreaterThanOrEqual(0);
  expect(q!.explanation).not.toBe('');
  return q!;
}

describe('question generators', () => {
  it('Nghĩa: correct meaning among 4, distractors of the same type first', () => {
    const q = valid(meaningGenerator.generate(breakIce, ctx()));
    expect(q.prompt).toBe('break the ice');
    expect(q.options[q.correctIndex]).toBe(breakIce.meaning);
    const others = q.options.filter((_, i) => i !== q.correctIndex);
    expect(others.every((o) => idioms.some((i) => i.meaning === o))).toBe(true);
  });

  it('Cloze: blanks the (inflected) phrase in the example', () => {
    const q = valid(clozeGenerator.generate(lookInto, ctx()));
    expect(q.prompt).toBe('The police _____ the case.');
    expect(q.options[q.correctIndex]).toBe('looked into');
    expect(clozeGenerator.canGenerate(item('word', 'zebra'), pool)).toBe(false);
  });

  it('Collocation: blanks the words the wrong versions change', () => {
    expect(collocationParts(makeDecision)).toMatchObject({ correct: 'make', given: 'a decision', prompt: '_____ a decision', wrong: ['do', 'take', 'have'] });
    const q = valid(collocationGenerator.generate(makeDecision, ctx()));
    expect(q.options[q.correctIndex]).toBe('make');
    expect(q.options.sort()).toEqual(['do', 'have', 'make', 'take']);
    // Only 2 AI distractors: not enough, never padded with other words that might be valid.
    expect(collocationGenerator.canGenerate(heavyRain, pool)).toBe(false);
  });

  it('Particle: blank after the verb, AI particles first, then common ones', () => {
    const q = valid(particleGenerator.generate(lookInto, ctx()));
    expect(q.prompt).toBe('The police looked _____ the case.');
    expect(q.options[q.correctIndex]).toBe('into');
    expect(q.options).toEqual(expect.arrayContaining(['at', 'after']));
    expect(particleGenerator.canGenerate(runWord, pool)).toBe(false);
  });

  it('Error spot: the answer is the wrong sentence among 3 correct ones', () => {
    const q = valid(errorSpotGenerator.generate(makeDecision, ctx()));
    expect(q.options[q.correctIndex]).toBe('I did a decision yesterday.');
    expect(q.instruction).toContain('SAI');
    expect(errorSpotGenerator.canGenerate(breakIce, pool)).toBe(false);
  });

  it('Idiom context: Vietnamese situation, idiom options', () => {
    const q = valid(idiomContextGenerator.generate(breakIce, ctx()));
    expect(q.prompt).toBe(breakIce.examples[0].vi);
    expect(q.options[q.correctIndex]).toBe('break the ice');
    expect(q.options.filter((_, i) => i !== q.correctIndex).every((o) => idioms.some((i) => i.text === o))).toBe(true);
  });

  it('falls back to Nghĩa or Cloze when the item lacks data for the chosen kinds', () => {
    for (let seed = 1; seed < 20; seed++) {
      const q = generateQuestion(runWord, ['collocation', 'particle', 'idiomContext'], ctx(seed));
      expect(['meaning', 'cloze']).toContain(q.kind);
    }
    const kinds = new Set<string>();
    for (let seed = 1; seed < 40; seed++) kinds.add(generateQuestion(lookInto, ['particle', 'cloze', 'errorSpot'], ctx(seed)).kind);
    expect(kinds).toEqual(new Set(['particle', 'cloze', 'errorSpot']));
  });

  it('pickDistractors prefers the same type and skips duplicates', () => {
    const d = pickDistractors(breakIce, pool, mulberry32(3), 3, (p) => p.text, ['break the ice']);
    expect(d.sort()).toEqual(idioms.map((i) => i.text).sort());
  });

  it('tiny decks still get 4 options from the built-in words', () => {
    const solo = item('idiom', 'once in a blue moon');
    const q = valid(generateQuestion(solo, ['meaning'], { pool: battlePool(BUILTIN_ITEMS, [solo]), rng: mulberry32(2), seq: 1 }));
    expect(q.options[q.correctIndex]).toBe(solo.meaning);
  });

  it('only own-deck selections may be smaller than 10', () => {
    expect(minSelected([{ deckId: 'd' }])).toBe(1);
    expect(minSelected([{ deckId: 'd' }, {}])).toBe(10);
  });
});

describe('battle → FSRS', () => {
  it('wrong = Again, right = Good, only for items of the player decks', () => {
    const a = { ...lookInto, deckId: 'd1' };
    const b = { ...breakIce, deckId: 'd1', id: 'x~2', sourceId: 'x' };
    const c = BUILTIN_ITEMS[0];
    const unasked = { ...runWord, deckId: 'd1' };
    let s = initGame({ p1: 'A', p2: 'B' });
    const q = (id: string) => ({ id: `q-${id}`, itemId: id, kind: 'meaning' as const, prompt: '', instruction: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' });
    for (const [id, ans] of [[a.id, 1], [b.id, 0], [c.id, 1], [a.id, 0]] as const) {
      s = resolveRound(startRound({ ...s, phase: 'question' }, q(id)), { p1: { answerIndex: ans, ms: 100 }, p2: { answerIndex: null, ms: 0 } });
    }
    const r = battleReviews(s, 'p1', [a, b, c, unasked]);
    expect(r).toEqual([
      { deckId: 'd1', itemId: a.id, type: 'phrasal_verb', grade: Rating.Again },
      { deckId: 'd1', itemId: 'x', type: 'idiom', grade: Rating.Good },
    ]);
  });
});
