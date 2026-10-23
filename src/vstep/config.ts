import vstepJson from '../../api/Shared/vstep.json';

/**
 * VSTEP Writing settings shared with the API (api/Shared/vstep.json). Every number used for timing,
 * word limits, scoring and levels comes from there; change that file to follow the official guide.
 */
export const VSTEP = vstepJson;

export type TaskNo = 1 | 2;
export const TASKS: readonly TaskNo[] = [1, 2];
export type TargetLevel = 'B1' | 'B2' | 'C1';
export const TARGET_LEVELS = VSTEP.targetLevels as TargetLevel[];
export type Band = 'none' | 'B1' | 'B2' | 'C1';

export const CRITERIA = ['taskFulfilment', 'organization', 'vocabulary', 'grammar'] as const;
export type Criterion = (typeof CRITERIA)[number];
export const CRITERION_LABELS = Object.fromEntries(VSTEP.criteria.map((c) => [c.id, c.label])) as Record<Criterion, string>;

export const ERROR_CATEGORIES = ['grammar', 'vocabulary', 'spelling', 'punctuation', 'coherence', 'task', 'register'] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
export const CATEGORY_LABELS = Object.fromEntries(VSTEP.errorCategories.map((c) => [c.id, c.label])) as Record<ErrorCategory, string>;
export const RULE_LABELS: Record<string, string> = Object.fromEntries(VSTEP.errorRules.map((r) => [r.id, r.label]));

export const TOPIC_LABELS: Record<string, string> = { ...Object.fromEntries(VSTEP.topics.map((t) => [t.id, t.label])), custom: 'Đề tự nhập' };
export const ESSAY_TYPE_LABELS: Record<string, string> = Object.fromEntries(VSTEP.essayTypes.map((t) => [t.id, t.label]));

export const taskConfig = (task: TaskNo) => VSTEP.tasks[String(task) as '1' | '2'];

/** Practice mode: one task with its suggested time; exam: both tasks sharing one clock. */
export type WritingMode = 'task1' | 'task2' | 'exam';
export const MODE_LABELS: Record<WritingMode, string> = {
  task1: VSTEP.tasks['1'].label,
  task2: VSTEP.tasks['2'].label,
  exam: `Thi thử (cả 2 task · ${VSTEP.examMinutes} phút)`,
};
export const modeTasks = (mode: WritingMode): TaskNo[] => (mode === 'exam' ? [1, 2] : mode === 'task1' ? [1] : [2]);
export const modeMinutes = (mode: WritingMode) => (mode === 'exam' ? VSTEP.examMinutes : taskConfig(mode === 'task1' ? 1 : 2).minutes);
