import { describe, expect, it } from 'vitest';
import { deckFromMyWords, migrateDeck, sanitizeItem } from './migrate';
import { DECK_SCHEMA_VERSION, duplicateIds, emptyItem, validateDeck, validateItem, newDeck } from './types';

describe('migrateDeck words[] → items[]', () => {
  const v1 = {
    id: 'd1',
    name: 'Old deck',
    description: 'x',
    level: 'B1',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    words: [
      { id: 'w1', word: 'resilient', meaning: 'kiên cường', example: 'She is resilient.', ipa: '/rɪˈzɪliənt/', note: 'adj' },
      { word: 'cat', meaning: 'con mèo', example: '' },
      'garbage',
    ],
  };

  it('turns each old word into a "word" item with example → examples[0]', () => {
    const d = migrateDeck(v1);
    expect(d.schemaVersion).toBe(DECK_SCHEMA_VERSION);
    expect(d.items).toHaveLength(2);
    expect(d.items[0]).toEqual({
      id: 'w1',
      type: 'word',
      text: 'resilient',
      meaning: 'kiên cường',
      examples: [{ en: 'She is resilient.', vi: '' }],
      tags: [],
      ipa: '/rɪˈzɪliənt/',
      note: 'adj',
    });
    expect(d.items[1].examples).toEqual([]);
    expect(d.items[1].id).toBeTruthy();
    expect(d).not.toHaveProperty('words');
    expect(d.createdAt).toBe(v1.createdAt);
  });

  it('keeps current decks and sanitizes items', () => {
    const d = migrateDeck({
      ...newDeck('New'),
      items: [{ id: 'i1', type: 'nope', text: 'x'.repeat(500), meaning: 'm', examples: [{ en: 'a', vi: 'b' }, { en: '' }], tags: ['t', 3] }],
    });
    expect(d.items[0].type).toBe('word');
    expect(d.items[0].text).toHaveLength(80);
    expect(d.items[0].examples).toEqual([{ en: 'a', vi: 'b' }]);
    expect(d.items[0].tags).toEqual(['t']);
  });

  it('caps examples at 5 and distractor lists at 6', () => {
    const it = sanitizeItem({
      type: 'phrasal_verb',
      text: 'look into',
      meaning: 'điều tra',
      examples: Array.from({ length: 9 }, (_, i) => ({ en: `e${i}`, vi: '' })),
      distractors: { wrongParticles: ['at', 'up', 'after', 'on', 'off', 'out', 'over', 'down'], wrongCollocations: 'x' },
    });
    expect(it.examples).toHaveLength(5);
    expect(it.distractors!.wrongParticles).toHaveLength(6);
    expect(it.distractors!.wrongCollocations).toEqual([]);
  });
});

describe('"Của tôi" migration', () => {
  it('builds a deck named "Của tôi" keeping the old ids', () => {
    const d = deckFromMyWords([
      { id: 'my:resilient', word: 'resilient', meaning: 'kiên cường', example: 'She is resilient.', level: 'B2' },
      { id: 'my:bad' },
    ]);
    expect(d!.name).toBe('Của tôi');
    expect(d!.items.map((i) => i.id)).toEqual(['my:resilient']);
    expect(d!.items[0].examples[0].en).toBe('She is resilient.');
  });

  it('returns null when there is nothing to migrate', () => {
    expect(deckFromMyWords([])).toBeNull();
    expect(deckFromMyWords('x')).toBeNull();
  });
});

describe('validation', () => {
  it('requires 2+ words for collocations and phrasal verbs', () => {
    expect(validateItem(emptyItem('collocation', { text: 'heavy', meaning: 'nặng' }))).toContain('Collocation cần ít nhất 2 từ.');
    expect(validateItem(emptyItem('collocation', { text: 'heavy rain', meaning: 'mưa to' }))).toEqual([]);
  });

  it('rejects wrong particles on non phrasal verbs', () => {
    const item = emptyItem('word', {
      text: 'run',
      meaning: 'chạy',
      distractors: { wrongCollocations: [], wrongParticles: ['up'], wrongSentences: [] },
    });
    expect(validateItem(item)).toHaveLength(1);
  });

  it('reports deck limits', () => {
    const deck = newDeck('');
    deck.items = Array.from({ length: 501 }, (_, i) => emptyItem('word', { text: `w${i}`, meaning: 'm' }));
    const errors = validateDeck(deck);
    expect(errors).toContain('Bộ từ cần có tên.');
    expect(errors).toContain('Mỗi bộ tối đa 500 mục.');
  });

  it('flags duplicates of the same type and text', () => {
    const a = emptyItem('word', { text: 'Run' });
    const b = emptyItem('word', { text: ' run ' });
    const c = emptyItem('phrasal_verb', { text: 'run' });
    expect([...duplicateIds([a, b, c])]).toEqual([b.id]);
  });
});
