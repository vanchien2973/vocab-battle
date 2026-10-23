import type { BattleItem } from '../data/words';
import { QUESTION_KINDS, type GameState, type PlayerId, type QuestionKind } from '../game/types';
import type { ConnectionStatus, GameTransport } from './transport';

export const COUNTDOWN_SECONDS = 3;
export const MAX_NAME_LENGTH = 20;

/**
 * lobby: waiting for / seeing each other · selecting: host picks words ·
 * preview: both review the words and mark ready · countdown: 3-2-1 · playing · over
 */
export type OnlinePhase = 'lobby' | 'selecting' | 'preview' | 'countdown' | 'playing' | 'over';

export interface OnlineSnapshot {
  status: ConnectionStatus;
  error: string | null;
  phase: OnlinePhase;
  hostName: string;
  guestName: string | null;
  words: BattleItem[];
  kinds: QuestionKind[];
  ready: { host: boolean; guest: boolean };
  countdown: number | null;
  game: GameState | null;
  opponentLeft: boolean;
}

/** What the online UI needs, whichever side it is on. */
export interface OnlineSession {
  readonly role: 'host' | 'guest';
  readonly me: PlayerId;
  readonly snapshot: OnlineSnapshot;
  subscribe(cb: (s: OnlineSnapshot) => void): () => void;
  setReady(ready: boolean): void;
  submitAnswer(questionId: string, answerIndex: number | null, ms: number): void;
  /** Host only: end the explanation after a round early. */
  skipReveal(): void;
  leave(): void;
}

export function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || fallback;
}

/** Snapshot bookkeeping and the 3-2-1 countdown shared by host and guest. */
export abstract class SessionBase {
  snapshot: OnlineSnapshot;
  private listeners = new Set<(s: OnlineSnapshot) => void>();
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private wasConnected = false;
  protected readonly unsubscribers: Array<() => void> = [];

  constructor(protected readonly transport: GameTransport, hostName: string) {
    this.snapshot = {
      status: transport.status,
      error: transport.error,
      phase: 'lobby',
      hostName,
      guestName: null,
      words: [],
      kinds: [...QUESTION_KINDS],
      ready: { host: false, guest: false },
      countdown: null,
      game: null,
      opponentLeft: false,
    };
    this.unsubscribers.push(
      transport.onStatus((status, error) => {
        this.update({ status, error });
        if (status === 'connected') {
          this.wasConnected = true;
          this.onConnected();
        } else if (this.wasConnected && (status === 'disconnected' || status === 'error')) {
          this.opponentGone();
        }
      }),
    );
  }

  subscribe(cb: (s: OnlineSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected update(patch: Partial<OnlineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const cb of [...this.listeners]) cb(this.snapshot);
  }

  protected onConnected(): void {}

  protected opponentGone(): void {
    if (this.snapshot.opponentLeft) return;
    this.stopCountdown();
    this.cleanup();
    this.update({ opponentLeft: true });
  }

  protected startCountdown(seconds: number, onDone: () => void): void {
    this.stopCountdown();
    this.update({ phase: 'countdown', countdown: seconds });
    const tick = (left: number) => {
      if (left <= 0) {
        this.countdownTimer = null;
        this.update({ countdown: null });
        onDone();
        return;
      }
      this.update({ countdown: left });
      this.countdownTimer = setTimeout(() => tick(left - 1), 1000);
    };
    tick(seconds);
  }

  protected stopCountdown(): void {
    if (this.countdownTimer !== null) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
  }

  /** Stop timers / matches; subclasses extend. */
  protected cleanup(): void {
    this.stopCountdown();
  }

  leave(): void {
    this.transport.send({ type: 'leave' });
    this.cleanup();
    for (const u of this.unsubscribers) u();
    this.listeners.clear();
    this.transport.close();
  }
}
