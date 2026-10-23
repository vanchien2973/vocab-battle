import type { BattleItem } from '../data/words';
import { ROUND_TIME_MS, initGame, resolveRound, startRound } from './engine';
import { createDeck, DEFAULT_KINDS, drawQuestion, type Deck } from './questions';
import { defaultRng, type Rng } from './rng';
import { PLAYER_IDS, type Answer, type GameState, type PlayerId, type QuestionKind } from './types';

/** The answer and a short explanation stay up this long (players can skip). */
export const REVEAL_MS = 2200;

export interface MatchOptions {
  names: Record<PlayerId, string>;
  /** Items the questions are drawn from. */
  selected: readonly BattleItem[];
  /** Items wrong options are drawn from (selected items plus built-in words). */
  pool: readonly BattleItem[];
  /** Question kinds to use (default: all). */
  kinds?: readonly QuestionKind[];
  rng?: Rng;
  roundTimeMs?: number;
  /** Extra wait after the round time before forcing resolution (network latency). */
  graceMs?: number;
  revealMs?: number;
}

type Listener = (state: GameState) => void;

/** What player controllers (human UI, bot, remote peer) need from a running match. */
export interface MatchLike {
  readonly state: GameState;
  subscribe(listener: Listener): () => void;
  submit(playerId: PlayerId, questionId: string, answerIndex: number | null, ms: number): boolean;
}

/**
 * Drives the pure engine with timers: draws questions, collects one answer per player per
 * question, resolves when both answered or time is up, then shows the result briefly.
 */
export class Match implements MatchLike {
  state: GameState;
  private deck: Deck;
  private seq = 0;
  private answers: Partial<Record<PlayerId, Answer>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private readonly rng: Rng;
  private readonly roundTimeMs: number;
  private readonly graceMs: number;
  private readonly revealMs: number;

  constructor(private readonly opts: MatchOptions) {
    this.rng = opts.rng ?? defaultRng;
    this.roundTimeMs = opts.roundTimeMs ?? ROUND_TIME_MS;
    this.graceMs = opts.graceMs ?? 0;
    this.revealMs = opts.revealMs ?? REVEAL_MS;
    this.state = initGame(opts.names);
    this.deck = createDeck(opts.selected, this.rng);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.nextRound();
  }

  stop(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  /** End the explanation early and go to the next question. */
  skipReveal(): void {
    if (this.state.phase === 'reveal') this.nextRound();
  }

  /** Returns false when the answer is stale, duplicated or arrives outside a question phase. */
  submit(playerId: PlayerId, questionId: string, answerIndex: number | null, ms: number): boolean {
    const q = this.state.question;
    if (this.state.phase !== 'question' || !q || q.id !== questionId || this.answers[playerId]) return false;
    this.answers[playerId] = { answerIndex, ms };
    if (PLAYER_IDS.every((id) => this.answers[id])) this.resolve();
    return true;
  }

  private nextRound(): void {
    const { question, deck } = drawQuestion(this.deck, this.opts.selected, this.opts.pool, this.rng, ++this.seq, this.opts.kinds ?? DEFAULT_KINDS);
    this.deck = deck;
    this.answers = {};
    this.setState(startRound(this.state, question));
    this.schedule(() => this.resolve(), this.roundTimeMs + this.graceMs);
  }

  private resolve(): void {
    this.clearTimer();
    this.setState(resolveRound(this.state, this.answers, this.roundTimeMs));
    if (this.state.phase === 'reveal') this.schedule(() => this.nextRound(), this.revealMs);
  }

  private schedule(fn: () => void, ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(fn, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: GameState): void {
    this.state = state;
    for (const l of [...this.listeners]) l(state);
  }
}
