import { readJSON, writeJSON } from '../storage/safeStorage';
import { DEFAULT_LIMITS, type StudyLimits } from './queue';

const KEY = 'vocab-battle.study.v1';
const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

/** Daily limits for "Ôn hôm nay" (Settings). */
export function loadStudyLimits(): StudyLimits {
  const s = readJSON<Partial<StudyLimits>>(KEY, {});
  return {
    newPerDay: clamp(s.newPerDay, 0, 500, DEFAULT_LIMITS.newPerDay),
    reviewsPerDay: clamp(s.reviewsPerDay, 1, 2000, DEFAULT_LIMITS.reviewsPerDay),
  };
}

export function saveStudyLimits(limits: StudyLimits): void {
  writeJSON(KEY, limits);
}
