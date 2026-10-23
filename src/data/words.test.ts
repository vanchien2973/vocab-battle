import { describe, expect, it } from 'vitest';
import { ALL_WORDS, BUILTIN_ITEMS, LEVELS, builtinFromIds, filterItems } from './words';

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

describe('built-in items', () => {
  it('are "word" items with the example as examples[0]', () => {
    expect(BUILTIN_ITEMS[0]).toMatchObject({ id: 'apple', type: 'word', text: 'apple', meaning: 'quả táo', level: 'A1', examples: [{ en: ALL_WORDS[0].example, vi: '' }] });
  });

  it('filters by level and search on text or meaning', () => {
    expect(filterItems(BUILTIN_ITEMS, 'A1', 'táo').map((w) => w.id)).toEqual(['apple']);
    expect(filterItems(BUILTIN_ITEMS, 'B2', 'apple')).toEqual([]);
    expect(filterItems(BUILTIN_ITEMS, 'all', '').length).toBe(ALL_WORDS.length);
  });

  it('drops unknown ids', () => {
    expect(builtinFromIds(['apple', 'nope']).map((w) => w.id)).toEqual(['apple']);
  });
});
