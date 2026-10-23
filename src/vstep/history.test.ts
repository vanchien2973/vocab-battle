import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { VocabDb } from '../decks/db';
import { LocalWritingRepository } from './repository';
import { buildGradeResult } from './scoring';
import { addCounts, emptyStats, errorCountsOf, summarizeWriting, topCounts } from './stats';
import type { WritingError, WritingRecord } from './types';

const e = (category: WritingError['category'], rule: string): WritingError => ({
  quote: 'q',
  occurrence: 1,
  category,
  rule,
  severity: 'minor',
  correction: '',
  explanationVi: '',
});

const crit = (score: number) => ({ score, comment: '', evidence: [] });
function record(id: string, promptId: string, errors: WritingError[], createdAt = '2026-10-20T00:00:00Z'): Omit<WritingRecord, 'attempt'> {
  const result = buildGradeResult(
    { criteria: { taskFulfilment: crit(7), organization: crit(6), vocabulary: crit(6.5), grammar: crit(5) }, errors, strengths: [], improvements: [] },
    { rewrite: 'r', usefulPhrases: [] },
    { task: 2, level: 'B2', wordCount: 260, model: 'm' },
  );
  return {
    id,
    task: 2,
    level: 'B2',
    topic: 'health',
    prompt: { task: 2, title: 'Sleep', text: 'Prompt', topic: 'health', essayType: 'opinion', requirements: [], register: '', source: 'ai' },
    promptId,
    text: 'Essay',
    wordCount: 260,
    durationSec: 1800,
    result,
    createdAt,
  };
}

describe('error statistics', () => {
  it('counts by category and rule, adds and removes without going negative', () => {
    const counts = errorCountsOf([e('grammar', 'article'), e('grammar', 'verb_tense'), e('grammar', 'article'), e('spelling', 'spelling')]);
    expect(counts).toEqual({ categories: { grammar: 3, spelling: 1 }, rules: { article: 2, verb_tense: 1, spelling: 1 } });
    const once = addCounts(emptyStats(), counts);
    const twice = addCounts(once, errorCountsOf([e('grammar', 'article')]));
    expect(twice).toEqual({ writings: 2, categories: { grammar: 4, spelling: 1 }, rules: { article: 3, verb_tense: 1, spelling: 1 } });
    const back = addCounts(twice, counts, -1);
    expect(back).toEqual({ writings: 1, categories: { grammar: 1 }, rules: { article: 1 } });
    expect(addCounts(emptyStats(), counts, -1)).toEqual(emptyStats());
    expect(topCounts(twice.rules, 2)).toEqual([
      ['article', 3],
      ['spelling', 1],
    ]);
  });

  it('summarizes a record for lists and charts', () => {
    const s = summarizeWriting({ ...record('a', 'p1', [e('task', 'content')]), attempt: 2, examId: 'x1' });
    expect(s).toMatchObject({ id: 'a', title: 'Sleep', attempt: 2, examId: 'x1', taskScore: 6, band: 'B2', criteria: { taskFulfilment: 7, grammar: 5 } });
    expect(s.errorCounts.categories).toEqual({ task: 1 });
  });
});

describe('LocalWritingRepository', () => {
  it('numbers attempts per prompt, keeps stats and lists newest first', async () => {
    const repo = new LocalWritingRepository(new VocabDb(`writings-${Math.random()}`));
    const a = await repo.add(record('a', 'p1', [e('grammar', 'article')], '2026-10-20T00:00:00Z'));
    const b = await repo.add(record('b', 'p1', [e('grammar', 'article'), e('vocabulary', 'collocation')], '2026-10-21T00:00:00Z'));
    const c = await repo.add(record('c', 'p2', [], '2026-10-22T00:00:00Z'));
    expect([a.attempt, b.attempt, c.attempt]).toEqual([1, 2, 1]);

    const h = await repo.history();
    expect(h.summaries.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(h.stats).toEqual({ writings: 3, categories: { grammar: 2, vocabulary: 1 }, rules: { article: 2, collocation: 1 } });
    expect((await repo.get('b')).text).toBe('Essay');

    await repo.remove('b');
    const after = await repo.history();
    expect(after.summaries.map((s) => s.id)).toEqual(['c', 'a']);
    expect(after.stats).toEqual({ writings: 2, categories: { grammar: 1 }, rules: { article: 1 } });
    await expect(repo.get('b')).rejects.toThrow(/Không tìm thấy/);
  });
});
