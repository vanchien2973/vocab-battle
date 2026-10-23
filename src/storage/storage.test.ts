import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHighScores, recordMatch } from './highScore';
import { newDeck, emptyItem } from '../decks/types';
import { deckItemKey, loadSelection, resolveSelection, saveSelection } from './selection';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('selection storage', () => {
  it('round-trips and resolves built-in and deck items, dropping unknown keys', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const a = newDeck('A', { items: [emptyItem('idiom', { id: 'i1', text: 'break the ice', meaning: 'phá băng' })] });
    const b = newDeck('B', { items: [emptyItem('idiom', { id: 'i1', text: 'break the ice', meaning: 'phá băng' })] });
    const sel = { keys: ['apple', 'gone', deckItemKey(a.id, 'i1'), deckItemKey(b.id, 'i1'), 'x|y'], deckIds: [a.id, b.id], kinds: ['meaning' as const] };
    saveSelection(sel);
    expect(loadSelection()).toEqual(sel);
    const items = resolveSelection(sel.keys, [a, b]);
    expect(items.map((i) => i.id)).toEqual(['apple', 'i1', 'i1~2']);
    expect(items[1].deckId).toBe(a.id);
    expect(items[2]).toMatchObject({ deckId: b.id, sourceId: 'i1' });
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
    expect(() => saveSelection({ keys: ['apple'], deckIds: [], kinds: ['meaning'] })).not.toThrow();
    expect(loadSelection().keys).toEqual([]);
  });

  it('ignores corrupted data', () => {
    const s = memoryStorage();
    s.setItem('vocab-battle.selection.v2', '{not json');
    vi.stubGlobal('localStorage', s);
    expect(loadSelection().keys).toEqual([]);
    expect(loadSelection().kinds.length).toBe(6);
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
