import { describe, expect, it } from 'vitest';
import { BUILTIN_ITEMS, type BattleItem } from '../data/words';
import { emptyItem } from '../decks/types';
import { createTypingBot, stepBot } from './bot';
import {
  accuracy,
  backspace,
  CARDS_PER_MILESTONE,
  createField,
  difficulty,
  escape,
  hint,
  injectAttacks,
  MILESTONES,
  pickTarget,
  prepareTargets,
  step,
  takeOutbox,
  typeChar,
  wpm,
} from './engine';
import { diffInput, looksVietnameseIme, normalizeAnswer, normalizeChar } from './input';
import type { FieldState } from './types';

const items = BUILTIN_ITEMS.slice(0, 12);

/** Run the field until a card is on screen. */
function untilCards(s: FieldState, n = 1) {
  for (let i = 0; i < 2000 && s.cards.filter((c) => c.active).length < n; i++) step(s, 1 / 60);
}

/** Type the answer of the bottom-most card. */
function typeBottom(s: FieldState) {
  const slot = pickTarget(s, null);
  const answer = s.targets[s.cards[slot].target].answer;
  s.locked = slot;
  for (const ch of answer) typeChar(s, ch);
  return answer;
}

describe('seeded spawning', () => {
  it('gives the same sequence for the same seed, even if attacks differ', () => {
    const a = createField({ items, content: 'copy', seed: 42, hearts: 99 });
    const b = createField({ items, content: 'copy', seed: 42, hearts: 99 });
    injectAttacks(b, 2);
    const seqA: string[] = [];
    const seqB: string[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      for (const [s, seq] of [
        [a, seqA],
        [b, seqB],
      ] as const) {
        step(s, 1 / 60);
        for (const e of s.events) if (e.type === 'spawn' && !s.cards[e.card].attack) seq.push(s.targets[s.cards[e.card].target].answer);
        s.events.length = 0;
      }
    }
    const n = Math.min(seqA.length, seqB.length);
    expect(n).toBeGreaterThan(10);
    expect(seqB.slice(0, n)).toEqual(seqA.slice(0, n));
    expect(createField({ items, content: 'copy', seed: 43 }).order).not.toEqual(a.order);
  });
});

describe('targeting and keys', () => {
  const field = (list: BattleItem[]) => {
    const s = createField({ items: list, content: 'copy', seed: 1, maxActiveCap: 8 });
    untilCards(s, 2);
    return s;
  };

  it('locks the bottom-most card starting with the typed letter', () => {
    const s = field([emptyItem('word', { text: 'apple', meaning: 'táo' }), emptyItem('word', { text: 'ant', meaning: 'kiến' })]);
    const [first, second] = s.cards.filter((c) => c.active);
    first.y = 0.3;
    second.y = 0.7;
    typeChar(s, 'A');
    expect(s.locked).toBe(s.cards.indexOf(second));
  });

  it('right keys advance, wrong keys shake and break the combo, finishing destroys the card', () => {
    const s = field([emptyItem('word', { text: 'cat', meaning: 'mèo' }), emptyItem('word', { text: 'dog', meaning: 'chó' })]);
    s.combo = 3;
    const slot = s.cards.findIndex((c) => c.active && s.targets[c.target].answer === 'cat');
    expect(typeChar(s, 'c')).toBe(true);
    expect(s.locked).toBe(slot);
    expect(typeChar(s, 'x')).toBe(false);
    expect(s.combo).toBe(0);
    expect(s.cards[slot].shake).toBeGreaterThan(0);
    typeChar(s, 'a');
    typeChar(s, 't');
    expect(s.cards[slot].active).toBe(false);
    expect(s.locked).toBe(-1);
    expect(s.score).toBeGreaterThan(0);
    expect(s.outcomes.get(s.cards[slot].target)).toBe('assisted');
    expect(accuracy(s)).toBeCloseTo(3 / 4);
  });

  it('backspace steps back and unlocks at zero, escape unlocks', () => {
    const s = field([emptyItem('word', { text: 'cat', meaning: 'mèo' }), emptyItem('word', { text: 'cow', meaning: 'bò' })]);
    typeChar(s, 'c');
    typeChar(s, 'a');
    const slot = s.locked;
    backspace(s);
    expect(s.cards[slot].typed).toBe(1);
    backspace(s);
    expect(s.locked).toBe(-1);
    typeChar(s, 'c');
    escape(s);
    expect(s.locked).toBe(-1);
    expect(s.cards.every((c) => c.typed === 0)).toBe(true);
  });

  it('phrases need the space; case and diacritics do not matter', () => {
    const s = field([emptyItem('phrasal_verb', { text: 'Look  Into', meaning: 'điều tra' }), emptyItem('word', { text: 'café', meaning: 'cà phê' })]);
    expect(s.targets.map((t) => t.answer)).toEqual(['look into', 'cafe']);
    for (const ch of 'LOOK') typeChar(s, ch);
    expect(typeChar(s, 'i')).toBe(false); // missing space
    for (const ch of ' into') typeChar(s, ch);
    expect(s.cards.filter((c) => c.active).map((c) => s.targets[c.target].answer)).toEqual(['cafe']);
    for (const ch of 'cafÉ') typeChar(s, ch);
    expect(s.cards.some((c) => c.active)).toBe(false);
  });

  it('a hint reveals the next character for a penalty and marks the item assisted', () => {
    const s = field([emptyItem('word', { text: 'go', meaning: 'đi' }), emptyItem('word', { text: 'up', meaning: 'lên' })]);
    s.score = 100;
    hint(s);
    const slot = s.locked;
    expect(s.cards[slot].typed).toBe(1);
    expect(s.score).toBe(85);
    hint(s);
    expect(s.cards[slot].active).toBe(false);
    expect([...s.outcomes.values()]).toEqual(['assisted']);
  });
});

describe('progression', () => {
  it('speeds up and shows more cards with milestones', () => {
    const d1 = difficulty(1);
    const d20 = difficulty(20);
    expect(d20.speed).toBeGreaterThan(d1.speed);
    expect(d20.maxActive).toBeGreaterThan(d1.maxActive);
    expect(d20.spawnInterval).toBeLessThan(d1.spawnInterval);
    expect(difficulty(20, 3).maxActive).toBe(3);
  });

  it('missed cards cost hearts and end the game at zero', () => {
    const s = createField({ items, content: 'copy', seed: 5, hearts: 2 });
    for (let i = 0; i < 60 * 60 && !s.over; i++) step(s, 1 / 60);
    expect(s.over).toBe('dead');
    expect(s.hearts).toBe(0);
    expect([...s.outcomes.values()].every((o) => o === 'missed')).toBe(true);
  });

  it('clearing 20 milestones finishes the level', () => {
    const s = createField({ items, content: 'copy', seed: 7 });
    for (let i = 0; i < 60 * 60 * 30 && !s.over; i++) {
      step(s, 1 / 60);
      if (s.cards.some((c) => c.active)) typeBottom(s);
    }
    expect(s.over).toBe('cleared');
    expect(s.milestone).toBe(MILESTONES);
    expect(s.resolved).toBe(MILESTONES * CARDS_PER_MILESTONE);
  });

  it('combo 5 earns one attack card, combo 10 two more', () => {
    const s = createField({ items, content: 'copy', seed: 9 });
    let kills = 0;
    for (let i = 0; i < 60 * 600 && kills < 10; i++) {
      step(s, 1 / 60);
      if (s.cards.some((c) => c.active)) {
        typeBottom(s);
        kills++;
        if (kills === 5) expect(takeOutbox(s)).toBe(1);
      }
    }
    expect(takeOutbox(s)).toBe(2);
    expect(takeOutbox(s)).toBe(0);
  });

  it('attack cards are faster, red, and do not count for milestones', () => {
    const s = createField({ items, content: 'copy', seed: 3 });
    injectAttacks(s, 2);
    const attacks = s.cards.filter((c) => c.active && c.attack);
    expect(attacks).toHaveLength(2);
    expect(attacks[0].speed).toBeGreaterThan(difficulty(1).speed);
    s.locked = s.cards.indexOf(attacks[0]);
    for (const ch of s.targets[attacks[0].target].answer) typeChar(s, ch);
    expect(s.resolved).toBe(0);
  });

  it('computes WPM from correct characters over play time', () => {
    expect(wpm({ chars: 50, elapsed: 60 })).toBe(10);
    expect(wpm({ chars: 0, elapsed: 0 })).toBe(0);
  });
});

describe('content kinds', () => {
  it('meaning shows Vietnamese, listen hides text, cloze falls back to meaning', () => {
    const look = emptyItem('phrasal_verb', { text: 'look into', meaning: 'điều tra', examples: [{ en: 'They looked into it.', vi: '' }] });
    const cat = emptyItem('word', { text: 'cat', meaning: 'mèo' });
    expect(prepareTargets([cat], 'meaning')[0]).toMatchObject({ display: 'mèo', answer: 'cat' });
    expect(prepareTargets([cat], 'listen')[0]).toMatchObject({ display: '', answer: 'cat' });
    expect(prepareTargets([look, cat], 'cloze').map((t) => [t.kind, t.display, t.answer])).toEqual([
      ['cloze', 'They _____ it.', 'looked into'],
      ['meaning', 'mèo', 'cat'],
    ]);
  });
});

describe('typing bot', () => {
  it('types close to its WPM with its accuracy', () => {
    const s = createField({ items, content: 'copy', seed: 11, hearts: 99 });
    const bot = createTypingBot('normal', 11);
    for (let i = 0; i < 60 * 120; i++) {
      step(s, 1 / 60);
      stepBot(bot, s, 1 / 60);
    }
    expect(wpm(s)).toBeGreaterThan(15);
    expect(wpm(s)).toBeLessThan(45);
    expect(accuracy(s)).toBeGreaterThan(0.85);
    expect(s.resolved).toBeGreaterThan(5);
  });
});

describe('input with Vietnamese IMEs', () => {
  it('normalizes accented characters', () => {
    expect(normalizeChar('Â')).toBe('a');
    expect(normalizeChar('đ')).toBe('d');
    expect(normalizeChar('’')).toBe("'");
    expect(normalizeAnswer(' Don’t  Give Up ')).toBe("don't give up");
  });

  it('turns IME rewrites into backspace + letter', () => {
    expect(diffInput('a', 'â')).toEqual({ backspaces: 1, chars: ['a'] });
    expect(diffInput('loo', 'look')).toEqual({ backspaces: 0, chars: ['k'] });
    expect(diffInput('look', 'loo')).toEqual({ backspaces: 1, chars: [] });
    expect(diffInput('', 'Đi ')).toEqual({ backspaces: 0, chars: ['d', 'i', ' '] });
    expect(looksVietnameseIme('â')).toBe(true);
    expect(looksVietnameseIme('a')).toBe(false);
  });
});

describe('layout', () => {
  it('spreads new cards away from cards near the top', async () => {
    const { spreadX } = await import('./engine');
    const s = createField({ items, content: 'copy', seed: 1 });
    s.cards[0].active = true;
    s.cards[0].x = 0.5;
    s.cards[0].y = 0.1;
    expect(Math.abs(spreadX(s, 0.55) - 0.5)).toBeGreaterThanOrEqual(0.2);
    expect(spreadX(s, 0.2)).toBe(0.2);
  });
});

describe('results → FSRS and history', () => {
  it('maps clean / assisted / missed to Good / Hard / Again on the card of the content kind', async () => {
    const { typingReviews } = await import('./progress');
    const { Rating } = await import('../study/fsrs');
    const own = (id: string, extra: Partial<BattleItem> = {}): BattleItem => ({ ...emptyItem('word', { id, text: id, meaning: 'm' }), deckId: 'd1', ...extra });
    const reviews = typingReviews(
      [
        { item: own('a'), outcome: 'clean' },
        { item: own('b~2', { sourceId: 'b' }), outcome: 'assisted' },
        { item: own('c'), outcome: 'missed' },
        { item: BUILTIN_ITEMS[0], outcome: 'missed' },
      ],
      'meaning',
    );
    expect(reviews).toEqual([
      { deckId: 'd1', itemId: 'a', type: 'word', grade: Rating.Good, cardType: 'vi-en' },
      { deckId: 'd1', itemId: 'b', type: 'word', grade: Rating.Hard, cardType: 'vi-en' },
      { deckId: 'd1', itemId: 'c', type: 'word', grade: Rating.Again, cardType: 'vi-en' },
    ]);
    expect(typingReviews([{ item: own('a'), outcome: 'clean' }], 'listen')[0].cardType).toBe('listen');
  });

  it('keeps the newest 100 typing sessions without duplicates', async () => {
    const { mergeTypingSessions } = await import('../study/fsrs');
    const s = (i: number) => ({ at: new Date(Date.UTC(2026, 9, 23, 0, i)).toISOString(), score: i, wpm: 30, accuracy: 0.9, milestone: 2, content: 'copy' as const, mode: 'solo' as const });
    const merged = mergeTypingSessions(
      Array.from({ length: 90 }, (_, i) => s(i)),
      [...Array.from({ length: 20 }, (_, i) => s(i + 90)), { ...s(5), score: 999 }],
    );
    expect(merged).toHaveLength(100);
    expect(merged[0].score).toBe(10);
    expect(merged[99].score).toBe(109);
  });

  it('the progress queue sends a typing session to the "_typing" document', async () => {
    const { ProgressQueue, MemoryPendingStore } = await import('../study/progressQueue');
    const { emptyProgress, mergeProgress } = await import('../study/fsrs');
    const saved = new Map<string, ReturnType<typeof emptyProgress>>();
    const repo = {
      get: async (id: string) => saved.get(id) ?? emptyProgress(id),
      merge: async (id: string, b: Parameters<typeof mergeProgress>[1]) => {
        const m = mergeProgress(saved.get(id) ?? emptyProgress(id), b);
        saved.set(id, m);
        return m;
      },
    };
    const q = new ProgressQueue(repo, new MemoryPendingStore(), '');
    await q.recordTyping({ at: '2026-10-23T08:00:00.000Z', score: 50, wpm: 20, accuracy: 0.8, milestone: 2, content: 'cloze', mode: 'bot' });
    expect(saved.get('_typing')!.typing).toHaveLength(1);
  });
});
