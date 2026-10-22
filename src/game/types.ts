export type PlayerId = 'p1' | 'p2';
export const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2'];

export function opponentOf(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

export interface PlayerState {
  name: string;
  hp: number;
  combo: number;
  maxCombo: number;
  correct: number;
  damageDealt: number;
  /** Word ids this player answered wrong (or ran out of time on), in order, unique. */
  wrongWordIds: string[];
}

export interface Question {
  id: string;
  wordId: string;
  word: string;
  options: string[];
  /** -1 when hidden (e.g. sent to an online guest before the round resolves). */
  correctIndex: number;
}

/** A player's submission; answerIndex null means time ran out. */
export interface Answer {
  answerIndex: number | null;
  ms: number;
}

export interface PlayerRoundResult {
  answerIndex: number | null;
  ms: number | null;
  correct: boolean;
}

export interface RoundResult {
  questionId: string;
  correctIndex: number;
  players: Record<PlayerId, PlayerRoundResult>;
  attacker: PlayerId | null;
  damage: number;
}

export type Phase = 'question' | 'reveal' | 'over';

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  round: number;
  phase: Phase;
  question: Question | null;
  lastResult: RoundResult | null;
  winner: PlayerId | null;
}
