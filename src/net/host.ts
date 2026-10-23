import { BUILTIN_ITEMS, type BattleItem } from '../data/words';
import { Match, type MatchOptions } from '../game/match';
import { battlePool, DEFAULT_KINDS, minSelected } from '../game/questions';
import type { GameState, QuestionKind } from '../game/types';
import { isKinds, isTypingSetup, itemsForPeer, MAX_ITEMSET_CHARS, MAX_WORDSET, type Message, type TypingSetup } from './protocol';
import { COUNTDOWN_SECONDS, SessionBase, cleanName, type OnlineSession } from './session';
import type { GameTransport } from './transport';

/** Extra time the host waits for a guest answer beyond the round time (network latency). */
export const ONLINE_GRACE_MS = 2000;
/** Guest attack requests closer together than this are ignored (cheat/spam guard). */
export const ATTACK_MIN_INTERVAL_MS = 800;

export interface HostOptions {
  pool?: readonly BattleItem[];
  countdownSeconds?: number;
  match?: Partial<Pick<MatchOptions, 'rng' | 'roundTimeMs' | 'graceMs' | 'revealMs'>>;
}

/** Hide the correct answer (and its explanation) while a question is still open so the guest cannot peek. */
export function sanitizeForGuest(state: GameState): GameState {
  if (state.phase !== 'question' || !state.question) return state;
  return { ...state, question: { ...state.question, correctIndex: -1, explanation: '' } };
}

/**
 * Authoritative side of an online match: owns the word set, readiness, countdown and the
 * Match; the guest only sends answers and renders the states broadcast from here.
 */
export class HostSession extends SessionBase implements OnlineSession {
  readonly role = 'host';
  readonly me = 'p1';
  private match: Match | null = null;
  private lastGuestAttack = 0;
  private hostDone: 'dead' | 'race' | null = null;

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
      case 'typingStatus':
        if (this.snapshot.phase === 'playing' && this.snapshot.typing) {
          const { type, ...status } = msg;
          void type;
          this.emitTyping({ type: 'status', status });
        }
        return;
      case 'typingAttack': {
        // Guest attacks only count while playing, at most one request per interval.
        const now = this.now();
        if (this.snapshot.phase !== 'playing' || !this.snapshot.typing || now - this.lastGuestAttack < ATTACK_MIN_INTERVAL_MS) return;
        this.lastGuestAttack = now;
        this.emitTyping({ type: 'attack', count: msg.count });
        return;
      }
      case 'typingDone':
        if (this.snapshot.phase !== 'playing' || !this.snapshot.typing) return;
        if (msg.reason === 'dead') this.finishTyping('p1', `${this.snapshot.guestName ?? 'Khách'} hết tim`);
        else this.finishTyping('p2', `${this.snapshot.guestName ?? 'Khách'} qua mốc 20 trước`);
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

  /** Confirm the items and question kinds chosen in step 1 and move both sides to the preview. */
  setWordSet(words: readonly BattleItem[], kinds: readonly QuestionKind[] = DEFAULT_KINDS, typing: TypingSetup | null = null): boolean {
    const valid = [...new Map(words.map((w) => [w.id, w])).values()];
    if (valid.length < minSelected(valid) || valid.length > MAX_WORDSET || this.snapshot.guestName === null) return false;
    if (!isKinds([...kinds]) || (typing && !isTypingSetup(typing))) return false;
    if (this.snapshot.phase === 'countdown' || this.snapshot.phase === 'playing') return false;
    const message: Message = { type: 'itemset', items: itemsForPeer(valid), kinds: [...kinds], ...(typing ? { game: typing } : {}) };
    if (JSON.stringify(message).length > MAX_ITEMSET_CHARS) return false;
    this.stopMatch();
    this.update({ phase: 'preview', words: valid, kinds: [...kinds], game: null, typing, typingOver: null });
    this.transport.send(message);
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

  /** After a match: back to the preview with the same items. */
  rematch(): void {
    if (this.snapshot.phase !== 'over') return;
    // A typing rematch gets a new sequence of falling words.
    const t = this.snapshot.typing;
    this.setWordSet(this.snapshot.words, this.snapshot.kinds, t ? { ...t, seed: (Math.random() * 2 ** 32) >>> 0 } : null);
  }

  skipReveal(): void {
    this.match?.skipReveal();
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

  sendTypingAttack(count: number): void {
    if (this.snapshot.phase !== 'playing' || !this.snapshot.typing) return;
    // The host decides its own attacks; split larger bursts into allowed sizes.
    for (let n = count; n > 0; n -= 2) this.transport.send({ type: 'typingAttack', count: n >= 2 ? 2 : 1 });
  }

  reportTypingDone(reason: 'dead' | 'race'): void {
    if (this.snapshot.phase !== 'playing' || !this.snapshot.typing || this.hostDone) return;
    this.hostDone = reason;
    if (reason === 'dead') this.finishTyping('p2', `${this.snapshot.hostName} hết tim`);
    else this.finishTyping('p1', `${this.snapshot.hostName} qua mốc 20 trước`);
  }

  private finishTyping(winner: 'p1' | 'p2', reason: string): void {
    if (this.snapshot.typingOver) return;
    this.update({ phase: 'over', typingOver: { winner, reason } });
    this.transport.send({ type: 'typingOver', winner, reason });
  }

  /** Overridable clock (tests). */
  protected now(): number {
    return Date.now();
  }

  private startMatch(): void {
    if (this.snapshot.typing) {
      this.hostDone = null;
      this.lastGuestAttack = 0;
      this.update({ phase: 'playing', typingOver: null });
      this.transport.send({ type: 'typingStart' });
      return;
    }
    const match = new Match({
      names: { p1: this.snapshot.hostName, p2: this.snapshot.guestName ?? 'Khách' },
      selected: this.snapshot.words,
      kinds: this.snapshot.kinds,
      pool: battlePool(this.opts.pool ?? BUILTIN_ITEMS, this.snapshot.words),
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
