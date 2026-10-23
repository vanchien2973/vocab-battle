import { describe, expect, it, vi } from 'vitest';
import type { AiClient } from '../ai/types';
import { gradeDraft } from './grading';
import type { WritingDraft } from './drafts';
import { MemoryWritingRepository, type WritingRepository } from './repository';
import { bandOf, buildGradeResult, roundScore, shortEssayCap, taskScoreOf, writingScore } from './scoring';
import type { GradeInput, GradeResponse, WritingPrompt } from './types';

const crit = (score: number) => ({ score, comment: 'Nhận xét', evidence: ['quote'] });
const rawGrade = (scores: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
  criteria: { taskFulfilment: crit(scores[0]), organization: crit(scores[1]), vocabulary: crit(scores[2]), grammar: crit(scores[3]) },
  overallScore: 10,
  errors: [],
  strengths: ['a', 'b', 'c', 'd'],
  improvements: [],
  ...extra,
});

describe('VSTEP scoring', () => {
  it('rounds to 0.5 and averages the criteria', () => {
    expect(roundScore(6.24)).toBe(6);
    expect(roundScore(6.25)).toBe(6.5);
    expect(roundScore(6.75)).toBe(7);
    expect(taskScoreOf({ taskFulfilment: 7, organization: 6.5, vocabulary: 6, grammar: 5.5 })).toBe(6.5); // 6.25
    expect(taskScoreOf({ taskFulfilment: 5, organization: 5, vocabulary: 5, grammar: 5.5 })).toBe(5); // 5.125
  });

  it('weights Task 2 double in the Writing score', () => {
    expect(writingScore(6, 7)).toBe(6.5); // 6.67
    expect(writingScore(8, 5)).toBe(6); // 6.0
    expect(writingScore(5, 6.5)).toBe(6); // 6.0
    expect(writingScore(0, 9)).toBe(6);
  });

  it('maps scores to levels with the configured bands', () => {
    expect(bandOf(3.5)).toBe('none');
    expect(bandOf(4)).toBe('B1');
    expect(bandOf(5.5)).toBe('B1');
    expect(bandOf(6)).toBe('B2');
    expect(bandOf(8)).toBe('B2');
    expect(bandOf(8.5)).toBe('C1');
    expect(bandOf(10)).toBe('C1');
  });

  it('recomputes the task score, caps short essays and cleans the lists', () => {
    const ctx = { task: 2 as const, level: 'B2' as const, wordCount: 300, model: 'm' };
    const r = buildGradeResult(rawGrade([7, 6, 6, 5.5]), { rewrite: 'Better essay.', usefulPhrases: [] }, ctx);
    expect(r.taskScore).toBe(6); // 6.125, not the model's 10
    expect(r.band).toBe('B2');
    expect(r.strengths).toHaveLength(3);
    expect(r.shortPenalty).toBe(false);

    expect(shortEssayCap(125, 250)).toBe(5);
    const short = buildGradeResult(rawGrade([9, 7, 7, 7]), null, { ...ctx, wordCount: 125 }, 'timeout');
    expect(short.shortPenalty).toBe(true);
    expect(short.criteria.taskFulfilment.score).toBe(5);
    expect(short.rewrite).toBeNull();
    expect(short.rewriteError).toBe('timeout');

    const weird = buildGradeResult(
      rawGrade([12, -3, 6.3, Number.NaN], {
        errors: [
          { quote: 'he go', occurrence: 0, category: 'grammar', rule: 'subject_verb', severity: 'major', correction: 'he goes', explanationVi: 'x' },
          { quote: '', occurrence: 1, category: 'grammar', rule: 'x', severity: 'minor', correction: '', explanationVi: '' },
          { quote: 'foo', occurrence: 2, category: 'nonsense', rule: 'x', severity: 'minor', correction: '', explanationVi: '' },
          { quote: 'bar', occurrence: 2.7, category: 'spelling', rule: 'made_up', severity: 'huge', correction: 'baz', explanationVi: '' },
        ],
      }),
      { rewrite: 'x', usefulPhrases: [{ text: 'a b', type: 'collocation', meaningVi: 'ab', example: 'e' }, { text: 'A B', type: 'collocation', meaningVi: 'dup', example: '' }, { text: 'c', type: 'noun', meaningVi: 'bad type', example: '' }] },
      ctx,
    );
    expect(Object.values(weird.criteria).map((c) => c.score)).toEqual([10, 0, 6.5, 0]);
    expect(weird.errors).toEqual([
      expect.objectContaining({ quote: 'he go', occurrence: 1, severity: 'major' }),
      expect.objectContaining({ quote: 'bar', occurrence: 2, rule: 'other', severity: 'minor' }),
    ]);
    expect(weird.usefulPhrases.map((p) => p.text)).toEqual(['a b']);
  });
});

const prompt = (task: 1 | 2): WritingPrompt => ({ task, title: `T${task}`, text: `Prompt ${task}`, topic: 'health', essayType: '', requirements: [], register: '', source: 'ai' });

function fakeAi(saved = false) {
  const calls: GradeInput[] = [];
  const ai: Pick<AiClient, 'gradeWriting'> = {
    gradeWriting: vi.fn(async (input: GradeInput): Promise<GradeResponse> => {
      calls.push(input);
      const result = buildGradeResult(rawGrade([6, 6, 6, 6]), { rewrite: 'r', usefulPhrases: [] }, { task: input.task, level: input.level, wordCount: 3, model: 'm' });
      return saved ? { result, saved: { id: `w-${'a'.repeat(31)}${input.task}`, promptId: 'p'.repeat(16), attempt: 4 } } : { result };
    }),
  };
  return { ai, calls };
}

const examDraft = (texts: string[]): WritingDraft => ({
  id: 'current',
  mode: 'exam',
  level: 'B2',
  prompts: [prompt(1), prompt(2)],
  texts,
  active: 0,
  startedAt: 0,
  deadline: 3_600_000,
  spellcheck: false,
  savedAt: 0,
});

describe('gradeDraft', () => {
  it('stores local attempts and numbers repeats of the same prompt', async () => {
    const repo = new MemoryWritingRepository();
    const { ai } = fakeAi();
    const draft = { ...examDraft(['One two three.']), mode: 'task1' as const, prompts: [prompt(1)] };
    const first = await gradeDraft(draft, ai, repo, () => 90_000);
    const second = await gradeDraft(draft, ai, repo, () => 90_000);
    expect(first.records[0]).toMatchObject({ attempt: 1, durationSec: 90, task: 1, text: 'One two three.' });
    expect(second.records[0].attempt).toBe(2);
    expect(second.records[0].promptId).toBe(first.records[0].promptId);
    expect((await repo.history()).summaries).toHaveLength(2);
  });

  it('grades both exam tasks with one examId and skips an empty task', async () => {
    const { ai, calls } = fakeAi();
    const both = await gradeDraft(examDraft(['Letter text.', 'Essay text here.']), ai, new MemoryWritingRepository(), () => 1000);
    expect(both.exam).toBe(true);
    expect(calls.map((c) => c.task)).toEqual([1, 2]);
    expect(calls[0].examId).toBeTruthy();
    expect(calls[0].examId).toBe(calls[1].examId);

    calls.length = 0;
    const one = await gradeDraft(examDraft(['', 'Essay only.']), ai, new MemoryWritingRepository(), () => 1000);
    expect(one.records.map((r) => r.task)).toEqual([2]);
    await expect(gradeDraft(examDraft([' ', '']), ai, new MemoryWritingRepository())).rejects.toThrow(/trống/);
  });

  it('uses what the server saved when signed in', async () => {
    const { ai } = fakeAi(true);
    const cloud: WritingRepository = { ...new MemoryWritingRepository(), kind: 'cloud', add: vi.fn() } as unknown as WritingRepository;
    const s = await gradeDraft({ ...examDraft(['x']), mode: 'task1', prompts: [prompt(1)] }, ai, cloud);
    expect(s.records[0]).toMatchObject({ id: `w-${'a'.repeat(31)}1`, attempt: 4 });
    expect(cloud.add).not.toHaveBeenCalled();
  });
});
