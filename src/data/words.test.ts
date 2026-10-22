import { describe, expect, it } from 'vitest';
import { ALL_WORDS, LEVELS, filterWords, wordsFromIds } from './words';

describe('words.json', () => {
  it('has unique ids and meanings', () => {
    expect(new Set(ALL_WORDS.map((w) => w.id)).size).toBe(ALL_WORDS.length);
    expect(new Set(ALL_WORDS.map((w) => w.meaning)).size).toBe(ALL_WORDS.length);
  });

  it('covers every level with enough words', () => {
    for (const level of LEVELS) {
      expect(ALL_WORDS.filter((w) => w.level === level).length).toBeGreaterThanOrEqual(10);
    }
  });

  it('has all fields filled', () => {
    for (const w of ALL_WORDS) {
      expect(w.word && w.meaning && w.example).toBeTruthy();
    }
  });
});

describe('filterWords / wordsFromIds', () => {
  it('filters by level and search on word or meaning', () => {
    expect(filterWords(ALL_WORDS, 'A1', 'táo').map((w) => w.id)).toEqual(['apple']);
    expect(filterWords(ALL_WORDS, 'B2', 'apple')).toEqual([]);
    expect(filterWords(ALL_WORDS, 'all', '').length).toBe(ALL_WORDS.length);
  });

  it('drops unknown ids', () => {
    expect(wordsFromIds(['apple', 'nope']).map((w) => w.id)).toEqual(['apple']);
  });
});
