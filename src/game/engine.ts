import { calcDamage } from './damage';
import {
  PLAYER_IDS,
  opponentOf,
  type Answer,
  type GameState,
  type PlayerId,
  type PlayerRoundResult,
  type PlayerState,
  type Question,
  type RoundResult,
} from './types';

export const MAX_HP = 100;
export const ROUND_TIME_MS = 10_000;

function newPlayer(name: string): PlayerState {
  return { name, hp: MAX_HP, combo: 0, maxCombo: 0, correct: 0, damageDealt: 0, wrongWordIds: [] };
}

export function initGame(names: Record<PlayerId, string>): GameState {
  return {
    players: { p1: newPlayer(names.p1), p2: newPlayer(names.p2) },
    round: 0,
    phase: 'question',
    question: null,
    lastResult: null,
    winner: null,
  };
}

export function startRound(state: GameState, question: Question): GameState {
  if (state.phase === 'over') return state;
  return { ...state, round: state.round + 1, phase: 'question', question, lastResult: null };
}

/** An answer only counts if it was given within the round time. */
function normalize(answer: Answer | undefined, roundTimeMs: number): Answer | null {
  if (!answer || answer.answerIndex === null) return null;
  const ms = Math.max(0, answer.ms);
  return ms > roundTimeMs ? null : { answerIndex: answer.answerIndex, ms };
}

/**
 * Resolve the current round. Every correct answer extends that player's combo; only the
 * fastest correct player (by their own measured ms) deals damage. Wrong or missing
 * answers reset the combo and record the word for review.
 */
export function resolveRound(
  state: GameState,
  answers: Partial<Record<PlayerId, Answer>>,
  roundTimeMs = ROUND_TIME_MS,
): GameState {
  const q = state.question;
  if (!q || state.phase !== 'question') return state;

  const results = {} as Record<PlayerId, PlayerRoundResult>;
  const players = { ...state.players };
  for (const id of PLAYER_IDS) {
    const a = normalize(answers[id], roundTimeMs);
    const correct = a !== null && a.answerIndex === q.correctIndex;
    results[id] = { answerIndex: a?.answerIndex ?? null, ms: a?.ms ?? null, correct };
    const p = players[id];
    if (correct) {
      const combo = p.combo + 1;
      players[id] = { ...p, combo, maxCombo: Math.max(p.maxCombo, combo), correct: p.correct + 1 };
    } else {
      const wrongWordIds = p.wrongWordIds.includes(q.wordId) ? p.wrongWordIds : [...p.wrongWordIds, q.wordId];
      players[id] = { ...p, combo: 0, wrongWordIds };
    }
  }

  const correctIds = PLAYER_IDS.filter((id) => results[id].correct);
  let attacker: PlayerId | null = null;
  if (correctIds.length === 1) attacker = correctIds[0];
  else if (correctIds.length === 2) attacker = results.p1.ms! <= results.p2.ms! ? 'p1' : 'p2';

  let damage = 0;
  if (attacker) {
    damage = calcDamage(players[attacker].combo, results[attacker].ms!);
    const target = opponentOf(attacker);
    const actual = Math.min(damage, players[target].hp);
    players[target] = { ...players[target], hp: players[target].hp - actual };
    players[attacker] = { ...players[attacker], damageDealt: players[attacker].damageDealt + actual };
  }

  const loser = PLAYER_IDS.find((id) => players[id].hp <= 0);
  const lastResult: RoundResult = { questionId: q.id, correctIndex: q.correctIndex, players: results, attacker, damage };
  return {
    ...state,
    players,
    lastResult,
    phase: loser ? 'over' : 'reveal',
    winner: loser ? opponentOf(loser) : null,
  };
}

/** Score saved as high score: damage dealt, plus remaining HP when winning. */
export function matchScore(state: GameState, id: PlayerId): number {
  const p = state.players[id];
  return p.damageDealt + (state.winner === id ? p.hp : 0);
}
