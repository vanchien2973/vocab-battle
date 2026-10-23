import { CRITERIA, type Criterion } from './config';
import type { ErrorCounts, WritingError, WritingRecord, WritingStats, WritingSummary } from './types';

/** How many mistakes of each category and rule an essay has. */
export function errorCountsOf(errors: readonly WritingError[]): ErrorCounts {
  const out: ErrorCounts = { categories: {}, rules: {} };
  for (const e of errors) {
    out.categories[e.category] = (out.categories[e.category] ?? 0) + 1;
    out.rules[e.rule] = (out.rules[e.rule] ?? 0) + 1;
  }
  return out;
}

export const emptyStats = (): WritingStats => ({ writings: 0, categories: {}, rules: {} });

/** Add (sign 1) or remove (sign -1, deleted essay) one essay's counts; never below zero. */
export function addCounts(stats: WritingStats, counts: ErrorCounts, sign: 1 | -1 = 1): WritingStats {
  const out: WritingStats = { writings: Math.max(0, stats.writings + sign), categories: { ...stats.categories }, rules: { ...stats.rules } };
  const add = (bag: Record<string, number>, k: string, n: number) => {
    const v = (bag[k] ?? 0) + sign * n;
    if (v > 0) bag[k] = v;
    else delete bag[k];
  };
  for (const [k, n] of Object.entries(counts.categories)) add(out.categories, k, n ?? 0);
  for (const [k, n] of Object.entries(counts.rules)) add(out.rules, k, n);
  return out;
}

export function summarizeWriting(r: WritingRecord): WritingSummary {
  const s: WritingSummary = {
    id: r.id,
    task: r.task,
    level: r.level,
    topic: r.topic,
    title: r.prompt.title,
    promptId: r.promptId,
    attempt: r.attempt,
    wordCount: r.wordCount,
    durationSec: r.durationSec,
    createdAt: r.createdAt,
    taskScore: r.result.taskScore,
    band: r.result.band,
    criteria: Object.fromEntries(CRITERIA.map((c) => [c, r.result.criteria[c].score])) as Record<Criterion, number>,
    errorCounts: errorCountsOf(r.result.errors),
  };
  if (r.examId) s.examId = r.examId;
  return s;
}

/** Most frequent entries of a count bag, largest first. */
export const topCounts = (bag: Record<string, number | undefined>, n: number) =>
  Object.entries(bag)
    .filter((e): e is [string, number] => (e[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
