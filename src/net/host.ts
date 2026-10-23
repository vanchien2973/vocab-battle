import { ALL_WORDS, type Word } from '../data/words';
import { Match, type MatchOptions } from '../game/match';
import { MIN_SELECTED_WORDS } from '../game/questions';
import type { GameState } from '../game/types';
import { MAX_WORDSET, type Message } from './protocol';
import { COUNTDOWN_SECONDS, SessionBase, cleanName, type OnlineSession } from './session';
import type { GameTransport } from './transport';

/** Extra time the host waits for a guest answer beyond the round time (network latency). */
export const ONLINE_GRACE_MS = 2000;

export interface HostOptions {
  pool?: readonly Word[];
  countdownSeconds?: number;
  match?: Partial<Pick<MatchOptions, 'rng' | 'roundTimeMs' | 'graceMs' | 'revealMs'>>;
}

/** Hide the correct answer while a question is still open so the guest cannot peek. */
export function sanitizeForGuest(state: GameState): GameState {
  if (state.phase !== 'question' || !state.question) return state;
  return { ...state, question: { ...state.question, correctIndex: -1 } };
}

/**
 * Authoritative side of an online match: owns the word set, readiness, countdown and the
 * Match; the guest only sends answers and renders the states broadcast from here.
 */
export class HostSession extends SessionBase implements OnlineSession {
  readonly role = 'host';
  readonly me = 'p1';
  private match: Match | null = null;

  constructor(transport: GameTransport, hostName: string, private readonly opts: HostOptions = {}) {
    super(transport, cleanName(hostName, 'Chủ phòng'));
    this.unsubscribers.push(transport.onMessage((m) => this.handle(m)));
  }

  private handle(msg: Message): void {
    if (this.snapshot.opponentLeft) return;
    switch (msg.type) {
      case 'hello': {
        if (this.snapshot.guestName !== null) return;
        const guestName = cleanName(msg.name, 'Khách');
        this.update({ guestName });
        this.transport.send({ type: 'lobby', hostName: this.snapshot.hostName, guestName });
        return;
      }
      case 'ready':
        if (this.snapshot.phase !== 'preview') return;
        this.setReadiness({ ...this.snapshot.ready, guest: msg.ready });
        return;
      case 'answer':
        if (this.snapshot.phase === 'playing') this.match?.submit('p2', msg.questionId, msg.answerIndex, msg.ms);
        return;
      case 'leave':
        this.opponentGone();
        return;
      default:
        return; // host-to-guest messages are ignored
    }
  }

  /** Go to (or back to) step 1. Clears readiness on both sides. */
  beginSelecting(): void {
    const { phase, guestName } = this.snapshot;
    if (guestName === null || phase === 'countdown' || phase === 'playing') return;
    this.stopMatch();
    this.update({ phase: 'selecting', ready: { host: false, guest: false } });
    this.transport.send({ type: 'selecting' });
  }

  /** Confirm the word set chosen in step 1 and move both sides to the preview. */
  setWordSet(words: readonly Word[]): boolean {
    const valid = [...new Map(words.map((w) => [w.id, w])).values()];
    if (valid.length < MIN_SELECTED_WORDS || valid.length > MAX_WORDSET || this.snapshot.guestName === null) return false;
    if (this.snapshot.phase === 'countdown' || this.snapshot.phase === 'playing') return false;
    this.stopMatch();
    this.update({ phase: 'preview', words: valid, game: null });
    this.transport.send({ type: 'wordset', words: valid });
    this.setReadiness({ host: false, guest: false });
    return true;
  }

  setReady(ready: boolean): void {
    if (this.snapshot.phase !== 'preview') return;
    this.setReadiness({ ...this.snapshot.ready, host: ready });
  }

  submitAnswer(questionId: string, answerIndex: number | null, ms: number): void {
    this.match?.submit('p1', questionId, answerIndex, ms);
  }

  /** After a match: back to the preview with the same word set. */
  rematch(): void {
    if (this.snapshot.phase === 'over') this.setWordSet(this.snapshot.words);
  }

  private setReadiness(ready: { host: boolean; guest: boolean }): void {
    this.update({ ready });
    this.transport.send({ type: 'readyState', ...ready });
    if (ready.host && ready.guest) {
      const seconds = this.opts.countdownSeconds ?? COUNTDOWN_SECONDS;
      this.transport.send({ type: 'countdown', seconds });
      this.startCountdown(seconds, () => this.startMatch());
    }
  }

  private startMatch(): void {
    const match = new Match({
      names: { p1: this.snapshot.hostName, p2: this.snapshot.guestName ?? 'Khách' },
      selected: this.snapshot.words,
      // Saved words join the distractor pool so their meanings show up as options too.
      pool: [...(this.opts.pool ?? ALL_WORDS), ...this.snapshot.words.filter((w) => w.id.startsWith('my:'))],
      graceMs: ONLINE_GRACE_MS,
      ...this.opts.match,
    });
    this.match = match;
    match.subscribe((state) => {
      this.update({ game: state, phase: state.phase === 'over' ? 'over' : 'playing' });
      this.transport.send({ type: 'state', state: sanitizeForGuest(state) });
    });
    match.start();
  }

  private stopMatch(): void {
    this.match?.stop();
    this.match = null;
  }

  protected cleanup(): void {
    super.cleanup();
    this.stopMatch();
  }
}
