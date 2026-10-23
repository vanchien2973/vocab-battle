import errorsSchema from '../../api/AiShared/writing-errors.schema.json';
import gradeSchema from '../../api/AiShared/writing-grade.schema.json';
import promptSchema from '../../api/AiShared/writing-prompt.schema.json';
import rewriteSchema from '../../api/AiShared/writing-rewrite.schema.json';
import { prompts } from '../ai/shared';
import type { StructuredRequest } from '../ai/tasks';
import { AiError } from '../ai/types';
import { taskConfig, TARGET_LEVELS, VSTEP, type TargetLevel, type TaskNo } from './config';
import type { GradeInput, WritingPrompt } from './types';
import { countWords } from './wordCount';

// Requests built from the shared prompts (api/AiShared): the server builds the same ones, the BYOK client uses these.

/** Same default as AI_GRADING_MAX_TOKENS on the server. */
export const GRADING_MAX_TOKENS = 6000;
const PROMPT_MAX_TOKENS = 1500;

export interface PromptRequestInput {
  task: TaskNo;
  level: TargetLevel;
  /** Topic id from config ("random" picks one). */
  topic: string;
  /** Task 2 essay type id; "" = any. */
  essayType: string;
  /** Titles of recent prompts not to repeat. */
  avoid: string[];
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '');
const clip = (s: unknown, max: number) => clean(s).slice(0, max).trim();
const oneLine = (s: unknown, max: number) => clip(s, max).replace(/\s+/g, ' ');
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const noFences = (s: string) => s.replace(/"""/g, '"');

/** Fill {name} placeholders in one pass, so text from the player can never inject another placeholder. */
export const fillTemplate = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));

const requireTask = (task: unknown): TaskNo => {
  if (task !== 1 && task !== 2) throw new AiError('Task phải là 1 hoặc 2.', 400);
  return task;
};
const requireLevel = (level: unknown): TargetLevel => {
  if (!TARGET_LEVELS.includes(level as TargetLevel)) throw new AiError('Bậc mục tiêu phải là B1, B2 hoặc C1.', 400);
  return level as TargetLevel;
};

export function checkPromptInput(input: PromptRequestInput): PromptRequestInput {
  const task = requireTask(input.task);
  const topic = input.topic === 'random' ? pick(VSTEP.topics).id : input.topic;
  if (!VSTEP.topics.some((t) => t.id === topic)) throw new AiError('Chủ đề không hợp lệ.', 400);
  const essayType = task === 1 ? '' : input.essayType || pick(VSTEP.essayTypes).id;
  if (essayType && !VSTEP.essayTypes.some((t) => t.id === essayType)) throw new AiError('Dạng bài không hợp lệ.', 400);
  const avoid = (input.avoid ?? []).map((a) => oneLine(a, VSTEP.maxTitleLength)).filter(Boolean).slice(0, VSTEP.maxAvoid);
  return { task, level: requireLevel(input.level), topic, essayType, avoid };
}

export function writingPromptRequest(input: PromptRequestInput): StructuredRequest {
  const c = checkPromptInput(input);
  const cfg = taskConfig(c.task);
  const p = prompts.tasks.writingPrompt;
  const user = fillTemplate(p.user, {
    task: String(c.task),
    kind: cfg.kind,
    minWords: String(cfg.minWords),
    topic: VSTEP.topics.find((t) => t.id === c.topic)!.en,
    essayType: c.essayType || 'none (letter)',
    level: c.level,
    avoid: c.avoid.length ? c.avoid.map((a) => `- ${a}`).join('\n') : '(none)',
  });
  return { system: fillTemplate(p.system, { minWords: String(cfg.minWords) }), user, schemaName: 'writing-prompt', schema: promptSchema, maxTokens: PROMPT_MAX_TOKENS };
}

/** Clean a generated prompt (same as WritingService.CleanPrompt). */
export function cleanPrompt(raw: Record<string, unknown>, input: PromptRequestInput): WritingPrompt {
  const text = clip(raw.text, VSTEP.maxPromptLength);
  if (!text) throw new AiError('AI trả về đề trống, thử lại.', 502);
  const essayType = typeof raw.essayType === 'string' && VSTEP.essayTypes.some((t) => t.id === raw.essayType) ? raw.essayType : input.essayType;
  return {
    task: input.task,
    title: oneLine(raw.title, VSTEP.maxTitleLength) || oneLine(text, 60),
    text,
    topic: input.topic,
    essayType: input.task === 2 ? essayType : '',
    requirements: input.task === 1 ? (Array.isArray(raw.requirements) ? raw.requirements : []).map((r) => oneLine(r, 300)).filter(Boolean).slice(0, 5) : [],
    register: input.task === 1 && ['formal', 'informal', 'semi-formal'].includes(raw.register as string) ? (raw.register as string) : '',
    source: 'ai',
  };
}

/** A prompt pasted by the player. */
export function customPrompt(task: TaskNo, text: string): WritingPrompt {
  const t = clip(text, VSTEP.maxPromptLength);
  if (!t) throw new AiError('Hãy dán đề bài.', 400);
  return { task, title: oneLine(t, 80), text: t, topic: 'custom', essayType: '', requirements: [], register: '', source: 'custom' };
}

/** Validate a grading request before any AI call (WritingService.CheckGrade does the same). */
export function checkGradeInput(input: GradeInput): GradeInput & { wordCount: number } {
  const task = requireTask(input.task);
  const level = requireLevel(input.level);
  const promptText = clip(input.prompt?.text, VSTEP.maxPromptLength + 1);
  if (!promptText || promptText.length > VSTEP.maxPromptLength) throw new AiError(`Đề bài cần từ 1 đến ${VSTEP.maxPromptLength} ký tự.`, 400);
  const essay = clean(input.essay);
  const wordCount = countWords(essay);
  if (wordCount === 0) throw new AiError('Bài viết đang trống.', 400);
  if (wordCount > VSTEP.maxWords) throw new AiError(`Bài viết tối đa ${VSTEP.maxWords} từ (hiện có ${wordCount}).`, 400);
  return { ...input, task, level, essay, prompt: { ...input.prompt, task, text: promptText }, wordCount };
}

/** The three calls of a grading (run in parallel): scores + comments, the mistakes, the rewrite + useful phrases. */
export function gradeRequests(input: GradeInput): { grade: StructuredRequest; errors: StructuredRequest; rewrite: StructuredRequest; wordCount: number } {
  const c = checkGradeInput(input);
  const cfg = taskConfig(c.task);
  const values: Record<string, string> = {
    task: String(c.task),
    kind: cfg.kind,
    minWords: String(cfg.minWords),
    level: c.level,
    wordCount: String(c.wordCount),
    prompt: noFences(c.prompt.text),
    essay: noFences(c.essay),
  };
  const fill = (t: string) => fillTemplate(t, values);
  const g = prompts.tasks.writingGrade;
  const e = prompts.tasks.writingErrors;
  const r = prompts.tasks.writingRewrite;
  return {
    grade: { system: g.system, user: fill(g.user), schemaName: 'writing-grade', schema: gradeSchema, maxTokens: GRADING_MAX_TOKENS },
    errors: { system: e.system, user: fill(e.user), schemaName: 'writing-errors', schema: errorsSchema, maxTokens: GRADING_MAX_TOKENS },
    rewrite: { system: r.system, user: fill(r.user), schemaName: 'writing-rewrite', schema: rewriteSchema, maxTokens: GRADING_MAX_TOKENS },
    wordCount: c.wordCount,
  };
}
