import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ITEMS as ALL_WORDS } from '../data/words';
import { Match } from '../game/match';
import { mulberry32 } from '../game/rng';
import type { Question } from '../game/types';
import { BOT_ACCURACY, createBotController, decideBotAnswer, type BotLevel } from './bot';

const q: Question = { id: 'q1', itemId: 'w', kind: 'meaning', prompt: 'w', instruction: '', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: '' };

describe('decideBotAnswer', () => {
  it('waits between 2 and 5 seconds', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const { delayMs } = decideBotAnswer(q, 'normal', rng);
      expect(delayMs).toBeGreaterThanOrEqual(2000);
      expect(delayMs).toBeLessThanOrEqual(5000);
    }
  });

  it.each<BotLevel>(['easy', 'normal', 'hard'])('accuracy for %s matches its level', (level) => {
    const rng = mulberry32(42);
    const n = 4000;
    let correct = 0;
    for (let i = 0; i < n; i++) {
      const { answerIndex } = decideBotAnswer(q, level, rng);
      expect(answerIndex).toBeGreaterThanOrEqual(0);
      expect(answerIndex).toBeLessThan(4);
      if (answerIndex === q.correctIndex) correct++;
    }
    expect(correct / n).toBeCloseTo(BOT_ACCURACY[level], 1);
  });

  it('harder bots are more accurate', () => {
    expect(BOT_ACCURACY.easy).toBeLessThan(BOT_ACCURACY.normal);
    expect(BOT_ACCURACY.normal).toBeLessThan(BOT_ACCURACY.hard);
  });
});

describe('bot controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers each question within 5 s and stops after detach', () => {
    const match = new Match({ names: { p1: 'A', p2: 'Bot' }, selected: ALL_WORDS.slice(0, 10), pool: ALL_WORDS, rng: mulberry32(2) });
    const detach = createBotController('hard', mulberry32(9)).attach(match, 'p2');
    match.start();
    const submit = vi.spyOn(match, 'submit');
    vi.advanceTimersByTime(5000);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toBe('p2');
    detach();
    match.stop();
  });
});
