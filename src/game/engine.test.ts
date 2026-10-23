import { describe, expect, it } from 'vitest';
import { MAX_HP, initGame, matchScore, resolveRound, startRound } from './engine';
import type { GameState, Question } from './types';

const q = (n: number): Question => ({
  id: `q${n}`,
  itemId: `w${n}`,
  kind: 'meaning',
  prompt: `word${n}`,
  instruction: '',
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 0,
  explanation: '',
});

const fresh = () => startRound(initGame({ p1: 'An', p2: 'Bình' }), q(1));

function play(state: GameState, n: number, p1: number | null, p2: number | null, p1Ms = 1000, p2Ms = 2000) {
  const s = state.phase === 'question' && state.question?.id === `q${n}` ? state : startRound(state, q(n));
  return resolveRound(s, { p1: { answerIndex: p1, ms: p1Ms }, p2: { answerIndex: p2, ms: p2Ms } });
}

describe('engine', () => {
  it('starts with full HP', () => {
    const s = fresh();
    expect(s.players.p1.hp).toBe(MAX_HP);
    expect(s.round).toBe(1);
  });

  it('only the faster correct player deals damage, by their own ms', () => {
    const s = play(fresh(), 1, 0, 0, 3000, 2500);
    expect(s.lastResult!.attacker).toBe('p2');
    expect(s.players.p1.hp).toBe(MAX_HP - 11);
    expect(s.players.p2.hp).toBe(MAX_HP);
    // both still extend their combo
    expect(s.players.p1.combo).toBe(1);
    expect(s.players.p2.combo).toBe(1);
  });

  it('wrong answer resets combo and records the word', () => {
    let s = play(fresh(), 1, 0, 1);
    s = play(s, 2, 0, 1);
    expect(s.players.p1.combo).toBe(2);
    expect(s.players.p2.combo).toBe(0);
    expect(s.players.p2.wrongItemIds).toEqual(['w1', 'w2']);
    s = play(s, 3, 1, 0);
    expect(s.players.p1.combo).toBe(0);
    expect(s.players.p1.maxCombo).toBe(2);
  });

  it('combo increases damage', () => {
    let s = fresh();
    const hps: number[] = [];
    for (let n = 1; n <= 4; n++) {
      s = play(s, n, 0, 1, 9000);
      hps.push(s.lastResult!.damage);
    }
    expect(hps).toEqual([10, 12, 15, 20]);
  });

  it('treats timeouts and late answers as wrong', () => {
    const s = resolveRound(fresh(), { p1: { answerIndex: 0, ms: 11_000 } });
    expect(s.lastResult!.attacker).toBeNull();
    expect(s.players.p1.wrongItemIds).toEqual(['w1']);
    expect(s.players.p2.wrongItemIds).toEqual(['w1']);
  });

  it('ends the game when HP reaches 0', () => {
    let s = fresh();
    let n = 1;
    while (s.phase !== 'over' && n < 50) s = play(s, n++, 0, 1, 500);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('p1');
    expect(s.players.p2.hp).toBe(0);
    expect(s.players.p1.damageDealt).toBe(MAX_HP);
    expect(matchScore(s, 'p1')).toBe(MAX_HP + MAX_HP);
    // no further rounds after game over
    expect(startRound(s, q(99))).toBe(s);
  });

  it('ignores resolution outside the question phase', () => {
    const s = play(fresh(), 1, 0, 0);
    expect(resolveRound(s, {})).toBe(s);
  });
});
