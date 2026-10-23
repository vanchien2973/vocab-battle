import { ITEM_TYPES, LIMITS, type ItemType } from '../decks/types';
import { CRITERIA, ERROR_CATEGORIES, RULE_LABELS, taskConfig, VSTEP, type Band, type Criterion, type ErrorCategory, type TargetLevel, type TaskNo } from './config';
import type { CriterionResult, GradeResult, UsefulPhrase, WritingError } from './types';

// Same formulas as WritingScoring.cs; numbers come from api/Shared/vstep.json.

export const roundScore = (x: number) => Math.round(x / VSTEP.roundTo) * VSTEP.roundTo;

/** Task score: the mean of the four criteria, rounded to 0.5. */
export const taskScoreOf = (criteria: Record<Criterion, number>) => roundScore(CRITERIA.reduce((n, c) => n + criteria[c], 0) / CRITERIA.length);

/** Writing score of a full test: (Task 1 + Task 2 × 2) / 3, rounded to 0.5. */
export function writingScore(task1: number, task2: number): number {
  const w = VSTEP.writingWeights;
  return roundScore((task1 * w.task1 + task2 * w.task2) / (w.task1 + w.task2));
}

export function bandOf(score: number): Band {
  return (VSTEP.bands.find((b) => score >= b.min)?.level ?? 'none') as Band;
}

export const bandLabel = (band: Band) => VSTEP.bands.find((b) => b.level === band)?.label ?? band;

/** Highest task-fulfilment score an essay below the minimum length can get (proportional to its length). */
export const shortEssayCap = (words: number, minWords: number) => roundScore((VSTEP.shortEssayCapScale * Math.max(0, words)) / minWords);

// ---------- cleaning model output (the server does the same; BYOK runs it in the browser) ----------

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '');
const clip = (s: unknown, max: number) => clean(s).slice(0, max).trim();
const clampScore = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? roundScore(Math.min(10, Math.max(0, x))) : 0);
const list = (raw: unknown, max: number, len: number) =>
  (Array.isArray(raw) ? raw : [])
    .map((s) => clip(s, len))
    .filter(Boolean)
    .slice(0, max);

export interface GradeContext {
  task: TaskNo;
  level: TargetLevel;
  wordCount: number;
  model: string;
  now?: Date;
}

/**
 * Turn the two validated model outputs into a result: scores clamped, task fulfilment capped for short
 * essays, task score and level computed here (the model's own total is ignored), lists clipped.
 */
export function buildGradeResult(grade: Record<string, unknown>, rewrite: Record<string, unknown> | null, ctx: GradeContext, rewriteError?: string): GradeResult {
  const minWords = taskConfig(ctx.task).minWords;
  const rawCriteria = (grade.criteria ?? {}) as Record<string, Record<string, unknown>>;
  const criteria = {} as Record<Criterion, CriterionResult>;
  for (const c of CRITERIA) {
    const r = rawCriteria[c] ?? {};
    criteria[c] = { score: clampScore(r.score), comment: clip(r.comment, 1000), evidence: list(r.evidence, VSTEP.maxEvidence, 300) };
  }
  const shortPenalty = ctx.wordCount < minWords;
  if (shortPenalty) criteria.taskFulfilment.score = Math.min(criteria.taskFulfilment.score, shortEssayCap(ctx.wordCount, minWords));
  const taskScore = taskScoreOf(Object.fromEntries(CRITERIA.map((c) => [c, criteria[c].score])) as Record<Criterion, number>);
  const result: GradeResult = {
    task: ctx.task,
    level: ctx.level,
    wordCount: ctx.wordCount,
    minWords,
    criteria,
    taskScore,
    band: bandOf(taskScore),
    shortPenalty,
    errors: cleanErrors(grade.errors),
    strengths: list(grade.strengths, VSTEP.maxListItems, 400),
    improvements: list(grade.improvements, VSTEP.maxListItems, 400),
    rewrite: rewrite ? clip(rewrite.rewrite, 8000) || null : null,
    usefulPhrases: rewrite ? cleanPhrases(rewrite.usefulPhrases) : [],
    model: ctx.model,
    gradedAt: (ctx.now ?? new Date()).toISOString(),
  };
  if (!result.rewrite) result.rewriteError = rewriteError ?? 'Chưa tạo được bản viết lại.';
  return result;
}

export function cleanErrors(raw: unknown): WritingError[] {
  const out: WritingError[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object' || out.length === VSTEP.maxErrors) continue;
    const e = x as Record<string, unknown>;
    const quote = clip(e.quote, 300);
    const category = e.category as ErrorCategory;
    if (!quote || !ERROR_CATEGORIES.includes(category)) continue;
    out.push({
      quote,
      occurrence: typeof e.occurrence === 'number' && e.occurrence >= 1 ? Math.floor(e.occurrence) : 1,
      category,
      rule: typeof e.rule === 'string' && e.rule in RULE_LABELS ? e.rule : 'other',
      severity: e.severity === 'major' ? 'major' : 'minor',
      correction: clip(e.correction, 300),
      explanationVi: clip(e.explanationVi, 600),
    });
  }
  return out;
}

export function cleanPhrases(raw: unknown): UsefulPhrase[] {
  const f = LIMITS.fieldLength;
  const seen = new Set<string>();
  const out: UsefulPhrase[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object' || out.length === VSTEP.maxPhrases) continue;
    const p = x as Record<string, unknown>;
    const type = p.type as ItemType;
    const text = clip(p.text, f.text);
    const meaningVi = clip(p.meaningVi, f.meaning);
    if (!ITEM_TYPES.includes(type) || !text || !meaningVi || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, type, meaningVi, example: clip(p.example, f.example) });
  }
  return out;
}
