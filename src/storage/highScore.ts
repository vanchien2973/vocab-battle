import { readJSON, writeJSON } from './safeStorage';

export type ScoreMode = 'local' | 'bot' | 'online';

export interface HighScores {
  best: Record<ScoreMode, number>;
  bestCombo: number;
}

const KEY = 'vocab-battle.highscores.v1';
const EMPTY: HighScores = { best: { local: 0, bot: 0, online: 0 }, bestCombo: 0 };

export function loadHighScores(): HighScores {
  const s = readJSON<Partial<HighScores>>(KEY, {});
  return {
    best: { ...EMPTY.best, ...(s.best ?? {}) },
    bestCombo: typeof s.bestCombo === 'number' ? s.bestCombo : 0,
  };
}

/** Save a finished match; returns which records were broken. */
export function recordMatch(mode: ScoreMode, score: number, maxCombo: number): { newScore: boolean; newCombo: boolean } {
  const s = loadHighScores();
  const newScore = score > s.best[mode];
  const newCombo = maxCombo > s.bestCombo;
  if (newScore || newCombo) {
    writeJSON(KEY, {
      best: { ...s.best, [mode]: Math.max(score, s.best[mode]) },
      bestCombo: Math.max(maxCombo, s.bestCombo),
    });
  }
  return { newScore, newCombo };
}
