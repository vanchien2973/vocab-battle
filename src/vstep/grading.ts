import type { AiClient } from '../ai/types';
import { newId } from '../decks/types';
import type { WritingDraft } from './drafts';
import type { WritingRepository } from './repository';
import type { WritingRecord } from './types';
import { countWords, promptIdOf } from './wordCount';

export interface GradedSession {
  records: WritingRecord[];
  exam: boolean;
}

/**
 * Grade every written task of a draft (exam: both tasks in parallel, sharing an examId; an empty task is
 * skipped and scores 0). Signed in, the server already saved each attempt; otherwise it is stored locally.
 */
export async function gradeDraft(
  draft: WritingDraft,
  ai: Pick<AiClient, 'gradeWriting'>,
  repo: WritingRepository,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<GradedSession> {
  const exam = draft.mode === 'exam';
  const examId = exam ? `x${newId()}` : undefined;
  const durationSec = Math.max(0, Math.round((now() - draft.startedAt) / 1000));
  const jobs = draft.prompts
    .map((prompt, i) => ({ prompt, text: draft.texts[i] ?? '' }))
    .filter((j) => countWords(j.text) > 0);
  if (jobs.length === 0) throw new Error('Bài viết đang trống.');

  const records = await Promise.all(
    jobs.map(async ({ prompt, text }) => {
      const { result, saved } = await ai.gradeWriting({ task: prompt.task, level: draft.level, prompt, essay: text, durationSec, ...(examId ? { examId } : {}) }, signal);
      const base: Omit<WritingRecord, 'attempt'> = {
        id: saved?.id ?? `w-${newId()}${newId()}`,
        task: prompt.task,
        level: draft.level,
        topic: prompt.topic,
        prompt,
        promptId: saved?.promptId ?? (await promptIdOf(prompt.text)),
        ...(examId ? { examId } : {}),
        text: text.trim(),
        wordCount: result.wordCount,
        durationSec,
        result,
        createdAt: result.gradedAt,
      };
      if (saved) return { ...base, attempt: saved.attempt };
      return repo.kind === 'local' ? repo.add(base) : { ...base, attempt: 1 };
    }),
  );
  return { records: records.sort((a, b) => a.task - b.task), exam };
}
