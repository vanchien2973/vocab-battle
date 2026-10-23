import { describe, expect, it } from 'vitest';
import { changeRatio, wordDiff } from './diff';
import { findQuote, locateErrors, segments } from './locateErrors';
import { phraseDeckName, phrasesToItems } from './phrases';
import type { WritingError } from './types';

const err = (quote: string, occurrence = 1, over: Partial<WritingError> = {}): WritingError => ({
  quote,
  occurrence,
  category: 'grammar',
  rule: 'subject_verb',
  severity: 'minor',
  correction: 'x',
  explanationVi: 'y',
  ...over,
});

const essay = 'He go to school. Then he go home.\nShe don’t like  homework,  but he go anyway.';

describe('locateErrors', () => {
  it('finds the n-th occurrence of a quote', () => {
    expect(findQuote(essay, 'he go', 1)).toEqual({ start: 17 + 5, end: 17 + 10 });
    const third = findQuote(essay, 'he go', 2)!;
    expect(essay.slice(third.start, third.end)).toBe('he go');
    expect(third.start).toBeGreaterThan(40);
    expect(essay.slice(findQuote(essay, 'He go')!.start, findQuote(essay, 'He go')!.end)).toBe('He go');
  });

  it('matches loosely: case, curly quotes and extra spaces', () => {
    const q = findQuote(essay, "she don't like homework", 1)!;
    expect(essay.slice(q.start, q.end)).toBe('She don’t like  homework');
    const nl = findQuote(essay, 'home. She', 1)!;
    expect(essay.slice(nl.start, nl.end)).toBe('home.\nShe');
  });

  it('falls back to the first match when the occurrence is miscounted, null when absent', () => {
    expect(findQuote(essay, 'Then he', 5)).toEqual(findQuote(essay, 'Then he', 1));
    expect(findQuote(essay, 'they goes')).toBeNull();
    expect(findQuote(essay, '   ')).toBeNull();
  });

  it('puts missing and overlapping errors in the general list', () => {
    const errors = [
      err('to school'),
      err('he go', 2, { severity: 'major' }),
      err('go to', 1), // overlaps "He go" and "to school"
      err('not in the essay'),
      err('He go'),
    ];
    const { spans, general } = locateErrors(essay, errors);
    expect(spans.map((s) => s.index)).toEqual([4, 0, 1]); // sorted by position
    expect(general).toEqual([2, 3]);
    const segs = segments(essay, spans);
    expect(segs.map((s) => s.text).join('')).toBe(essay);
    expect(segs.filter((s) => s.index !== null).map((s) => s.text)).toEqual(['He go', 'to school', 'he go']);
  });

  it('places major errors first when two overlap', () => {
    const { spans, general } = locateErrors('a big mistake here', [err('big mistake'), err('mistake here', 1, { severity: 'major' })]);
    expect(spans.map((s) => s.index)).toEqual([1]);
    expect(general).toEqual([0]);
  });
});

describe('wordDiff', () => {
  it('marks only the changed words on each side', () => {
    const d = wordDiff('He go to school every day.', 'He goes to school every single day.');
    expect(d.before.filter((t) => t.changed).map((t) => t.text.trim())).toEqual(['go']);
    expect(d.after.filter((t) => t.changed).map((t) => t.text.trim())).toEqual(['goes', 'single']);
    expect(d.before.map((t) => t.text).join('')).toBe('He go to school every day.');
    expect(d.after.map((t) => t.text).join('')).toBe('He goes to school every single day.');
    expect(changeRatio(d)).toBeCloseTo(2 / 7);
  });

  it('handles empty texts', () => {
    expect(wordDiff('', 'New text').after.every((t) => t.changed)).toBe(true);
    expect(wordDiff('Old', '').before).toEqual([{ text: 'Old', changed: true }]);
  });
});

describe('useful phrases → items', () => {
  it('keeps the type, meaning and example and tags the topic', () => {
    const items = phrasesToItems(
      [
        { text: 'have a detrimental effect on', type: 'collocation', meaningVi: 'có ảnh hưởng xấu tới', example: 'Noise has a detrimental effect on health.' },
        { text: 'cut down on', type: 'phrasal_verb', meaningVi: 'cắt giảm', example: '' },
      ],
      'environment',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'collocation',
      text: 'have a detrimental effect on',
      meaning: 'có ảnh hưởng xấu tới',
      examples: [{ en: 'Noise has a detrimental effect on health.', vi: '' }],
      tags: ['vstep-writing', 'environment'],
    });
    expect(items[1]).toMatchObject({ type: 'phrasal_verb', examples: [], tags: ['vstep-writing', 'environment'] });
    expect(items[0].id).not.toBe(items[1].id);
    expect(phrasesToItems([{ text: 'a', type: 'word', meaningVi: 'b', example: '' }], 'custom')[0].tags).toEqual(['vstep-writing']);
    expect(phraseDeckName('environment')).toBe('VSTEP Writing – Môi trường');
    expect(phraseDeckName('custom')).toBe('VSTEP Writing – Đề tự nhập');
  });
});
