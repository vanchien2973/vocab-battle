import { describe, expect, it } from 'vitest';
import { emptyItem, newDeck, type Item } from '../decks/types';
import { BLANK, findInSentence, makeCloze, sameAnswer } from './cloze';
import {
  Rating,
  cardKey,
  countReview,
  dayKey,
  emptyProgress,
  learnedPercent,
  leitnerToFsrs,
  mergeProgress,
  newCard,
  review,
  type DeckProgress,
} from './fsrs';
import { buildQueue, cardTypesFor, computeStats } from './queue';

const NOW = new Date(2026, 9, 23, 9, 0, 0);
const DAY = 86_400_000;

describe('cloze', () => {
  it('finds inflected multi-word items', () => {
    expect(makeCloze({ text: 'look into', examples: [{ en: 'The police looked into the case.', vi: '' }] })).toMatchObject({
      sentence: `The police ${BLANK} the case.`,
      answer: 'looked into',
    });
    expect(findInSentence('She is making a decision.', 'make a decision')).not.toBeNull();
    expect(findInSentence('He studies hard.', 'study')).not.toBeNull();
    expect(findInSentence('They stopped running.', 'stop')).not.toBeNull();
  });

  it('matches whole words only, ignoring case', () => {
    expect(findInSentence('Catalogs are useful.', 'cat')).toBeNull();
    expect(findInSentence('HEAVY RAIN fell.', 'heavy rain')).toEqual({ start: 0, end: 10 });
  });

  it('is only created when an example contains the text', () => {
    expect(makeCloze({ text: 'break the ice', examples: [{ en: 'Nice to meet you.', vi: '' }] })).toBeNull();
    expect(makeCloze({ text: 'x', examples: [] })).toBeNull();
  });

  it('compares typed answers loosely', () => {
    expect(sameAnswer('  Look  Into. ', 'look into')).toBe(true);
    expect(sameAnswer('', '')).toBe(false);
    expect(sameAnswer('look at', 'look into')).toBe(false);
  });
});

describe('FSRS scheduling', () => {
  it('schedules Again sooner than Good, and Good sooner than Easy', () => {
    const again = review(undefined, Rating.Again, NOW);
    const good = review(undefined, Rating.Good, NOW);
    const easy = review(undefined, Rating.Easy, NOW);
    expect(Date.parse(again.due)).toBeLessThanOrEqual(Date.parse(good.due));
    expect(Date.parse(good.due)).toBeLessThan(Date.parse(easy.due));
    expect(good.reps).toBe(1);
  });

  it('grows the interval on repeated Good reviews', () => {
    let c = review(undefined, Rating.Good, NOW);
    const gaps: number[] = [];
    let t = NOW.getTime();
    for (let i = 0; i < 4; i++) {
      t = Date.parse(c.due);
      const next = review(c, Rating.Good, new Date(t));
      gaps.push(Date.parse(next.due) - t);
      c = next;
    }
    expect(gaps[3]).toBeGreaterThan(gaps[1]);
    expect(c.state).toBe(2); // Review
  });

  it('estimates FSRS cards from Leitner boxes', () => {
    const last = new Date(2026, 9, 1);
    const box1 = leitnerToFsrs(1, last);
    const box5 = leitnerToFsrs(5, last, 0);
    const hard = leitnerToFsrs(5, last, 6);
    expect(Date.parse(box1.due) - last.getTime()).toBe(DAY);
    expect(Date.parse(box5.due) - last.getTime()).toBe(30 * DAY);
    expect(box5.state).toBe(2);
    expect(hard.difficulty).toBeGreaterThan(box5.difficulty);
    expect(hard.lapses).toBe(6);
    expect(leitnerToFsrs(9, 'nonsense').stability).toBe(30);
  });
});

describe('progress merge', () => {
  it('keeps the newer card, adds day counters and drops old days', () => {
    const older = review(undefined, Rating.Good, new Date(NOW.getTime() - DAY));
    const newer = review(older, Rating.Again, NOW);
    const p: DeckProgress = {
      ...emptyProgress('d'),
      cards: { 'a|en-vi': newer },
      days: { [dayKey(NOW)]: countReview(undefined, 'word', Rating.Good, true), '2020-01-01': countReview(undefined, 'word', Rating.Good, true) },
    };
    const merged = mergeProgress(p, { cards: { 'a|en-vi': older, 'b|cloze': newCard(NOW) }, days: { [dayKey(NOW)]: countReview(undefined, 'idiom', Rating.Again, false) } }, NOW);
    expect(merged.cards['a|en-vi']).toBe(newer);
    expect(merged.cards['b|cloze']).toBeDefined();
    expect(merged.days[dayKey(NOW)]).toMatchObject({ reviews: 2, again: 1, newCards: 1, byType: { word: [1, 1], idiom: [1, 0] } });
    expect(merged.days['2020-01-01']).toBeUndefined();
  });
});

function deckWith(items: Item[], id = 'd1') {
  return { ...newDeck('D'), id, items };
}

describe('today queue', () => {
  const words = Array.from({ length: 30 }, (_, i) => emptyItem('word', { id: `w${i}`, text: `word${i}`, meaning: `m${i}` }));

  it('offers cloze cards only when an example contains the text', () => {
    const a = emptyItem('word', { text: 'run', meaning: 'chạy', examples: [{ en: 'I run daily.', vi: '' }] });
    const b = emptyItem('word', { text: 'walk', meaning: 'đi', examples: [{ en: 'I go.', vi: '' }] });
    expect(cardTypesFor(a)).toContain('cloze');
    expect(cardTypesFor(b)).not.toContain('cloze');
  });

  it('puts due reviews first and limits new cards per day', () => {
    const p = emptyProgress('d1');
    const past = new Date(NOW.getTime() - 3 * DAY);
    p.cards[cardKey('w5', 'en-vi')] = review(review(undefined, Rating.Good, past), Rating.Good, past);
    p.cards[cardKey('w7', 'en-vi')] = { ...review(undefined, Rating.Good, past), due: new Date(NOW.getTime() - 5 * DAY).toISOString() };
    p.cards[cardKey('w9', 'en-vi')] = review(undefined, Rating.Easy, NOW); // not due yet
    const q = buildQueue([deckWith(words)], new Map([['d1', p]]), { now: NOW, cardTypes: ['en-vi'], limits: { newPerDay: 5, reviewsPerDay: 100 } });
    expect(q.slice(0, 2).map((c) => c.item.id)).toEqual(['w7', 'w5']);
    expect(q.filter((c) => !c.card)).toHaveLength(5);
    expect(q.some((c) => c.item.id === 'w9')).toBe(false);
  });

  it('subtracts what was already studied today across decks', () => {
    const p1 = emptyProgress('d1');
    let day = undefined;
    for (let i = 0; i < 4; i++) day = countReview(day, 'word', Rating.Good, true);
    p1.days[dayKey(NOW)] = day!;
    const q = buildQueue(
      [deckWith(words.slice(0, 10)), deckWith(words.slice(10), 'd2')],
      new Map([['d1', p1]]),
      { now: NOW, cardTypes: ['en-vi'], limits: { newPerDay: 6, reviewsPerDay: 100 } },
    );
    expect(q).toHaveLength(2);
  });

  it('computes streak, last 7 days and retention by type', () => {
    const p = emptyProgress('d1');
    for (const back of [0, 1, 2, 4]) {
      const k = dayKey(new Date(NOW.getTime() - back * DAY));
      p.days[k] = countReview(countReview(undefined, 'idiom', Rating.Good, false), 'idiom', Rating.Again, false);
    }
    const s = computeStats([deckWith(words)], new Map([['d1', p]]), NOW);
    expect(s.streak).toBe(3);
    expect(s.last7).toHaveLength(7);
    expect(s.last7[6]).toMatchObject({ reviews: 2, again: 1 });
    expect(s.retentionByType).toEqual([{ type: 'idiom', reviews: 8, rate: 0.5 }]);
  });

  it('reports learned percent from graduated cards', () => {
    const p = emptyProgress('d1');
    let c = review(undefined, Rating.Easy, NOW);
    c = review(c, Rating.Easy, new Date(Date.parse(c.due)));
    p.cards[cardKey('w0', 'en-vi')] = c;
    expect(learnedPercent(deckWith(words.slice(0, 4)), p)).toBe(25);
  });
});
