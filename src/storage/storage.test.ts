import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHighScores, recordMatch } from './highScore';
import { loadSelection, saveSelection } from './selection';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('selection storage', () => {
  it('round-trips and drops unknown ids', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    saveSelection(['apple', 'gone', 'book']);
    expect(loadSelection()).toEqual(['apple', 'book']);
  });

  it('survives a throwing localStorage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveSelection(['apple'])).not.toThrow();
    expect(loadSelection()).toEqual([]);
  });

  it('ignores corrupted data', () => {
    const s = memoryStorage();
    s.setItem('vocab-battle.selection.v1', '{not json');
    vi.stubGlobal('localStorage', s);
    expect(loadSelection()).toEqual([]);
  });
});

describe('high scores', () => {
  it('keeps the best score per mode and best combo', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(recordMatch('bot', 120, 3)).toEqual({ newScore: true, newCombo: true });
    expect(recordMatch('bot', 80, 5)).toEqual({ newScore: false, newCombo: true });
    expect(loadHighScores()).toEqual({ best: { local: 0, bot: 120, online: 0 }, bestCombo: 5 });
  });

  it('works without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadHighScores().best.bot).toBe(0);
    expect(() => recordMatch('local', 10, 1)).not.toThrow();
  });
});
