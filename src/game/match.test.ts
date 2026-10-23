import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ITEMS as ALL_WORDS } from '../data/words';
import { Match } from './match';
import { mulberry32 } from './rng';

const newMatch = () =>
  new Match({
    names: { p1: 'A', p2: 'B' },
    selected: ALL_WORDS.slice(0, 10),
    pool: ALL_WORDS,
    rng: mulberry32(3),
    roundTimeMs: 1000,
    revealMs: 100,
  });

describe('Match', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves when both players answered, then moves on', () => {
    const m = newMatch();
    m.start();
    const q = m.state.question!;
    expect(m.submit('p1', q.id, q.correctIndex, 300)).toBe(true);
    expect(m.state.phase).toBe('question');
    expect(m.submit('p2', q.id, q.correctIndex, 200)).toBe(true);
    expect(m.state.phase).toBe('reveal');
    expect(m.state.lastResult!.attacker).toBe('p2');
    vi.advanceTimersByTime(100);
    expect(m.state.round).toBe(2);
  });

  it('rejects duplicate and stale answers', () => {
    const m = newMatch();
    m.start();
    const q = m.state.question!;
    expect(m.submit('p1', q.id, 0, 100)).toBe(true);
    expect(m.submit('p1', q.id, 1, 50)).toBe(false);
    expect(m.submit('p2', 'old', 0, 50)).toBe(false);
  });

  it('resolves on timeout', () => {
    const m = newMatch();
    m.start();
    vi.advanceTimersByTime(1000);
    expect(m.state.phase).toBe('reveal');
    expect(m.state.lastResult!.attacker).toBeNull();
  });
});
