import { PROTOCOL_VERSION, type Message } from './protocol';
import { SessionBase, cleanName, type OnlineSession } from './session';
import type { GameTransport } from './transport';

/** Non-authoritative side: sends hello/ready/answers and renders what the host broadcasts. */
export class GuestSession extends SessionBase implements OnlineSession {
  readonly role = 'guest';
  readonly me = 'p2';
  private readonly name: string;

  constructor(transport: GameTransport, guestName: string) {
    super(transport, '');
    this.name = cleanName(guestName, 'Khách');
    this.update({ guestName: this.name });
    this.unsubscribers.push(transport.onMessage((m) => this.handle(m)));
    if (transport.status === 'connected') this.onConnected();
  }

  protected onConnected(): void {
    this.transport.send({ type: 'hello', name: this.name, version: PROTOCOL_VERSION });
  }

  private handle(msg: Message): void {
    if (this.snapshot.opponentLeft) return;
    switch (msg.type) {
      case 'lobby':
        this.update({ hostName: msg.hostName, guestName: msg.guestName });
        return;
      case 'selecting':
        this.stopCountdown();
        this.update({ phase: 'selecting', ready: { host: false, guest: false }, game: null });
        return;
      case 'itemset':
        this.stopCountdown();
        this.update({
          phase: 'preview',
          words: msg.items,
          kinds: msg.kinds,
          typing: msg.game ?? null,
          typingOver: null,
          ready: { host: false, guest: false },
          game: null,
        });
        return;
      case 'readyState':
        this.update({ ready: { host: msg.host, guest: msg.guest } });
        return;
      case 'countdown':
        // Display only; the host decides when the match actually starts.
        this.startCountdown(msg.seconds, () => {});
        return;
      case 'state':
        this.stopCountdown();
        this.update({ game: msg.state, countdown: null, phase: msg.state.phase === 'over' ? 'over' : 'playing' });
        return;
      case 'typingStart':
        this.stopCountdown();
        if (this.snapshot.typing) this.update({ phase: 'playing', countdown: null, typingOver: null });
        return;
      case 'typingStatus':
        if (this.snapshot.phase === 'playing' && this.snapshot.typing) {
          const { type, ...status } = msg;
          void type;
          this.emitTyping({ type: 'status', status });
        }
        return;
      case 'typingAttack':
        if (this.snapshot.phase === 'playing' && this.snapshot.typing) this.emitTyping({ type: 'attack', count: msg.count });
        return;
      case 'typingOver':
        if (this.snapshot.typing) this.update({ phase: 'over', typingOver: { winner: msg.winner, reason: msg.reason } });
        return;
      case 'leave':
        this.opponentGone();
        return;
      default:
        return; // guest-to-host messages are ignored
    }
  }

  setReady(ready: boolean): void {
    if (this.snapshot.phase !== 'preview') return;
    this.update({ ready: { ...this.snapshot.ready, guest: ready } });
    this.transport.send({ type: 'ready', ready });
  }

  submitAnswer(questionId: string, answerIndex: number | null, ms: number): void {
    this.transport.send({ type: 'answer', questionId, answerIndex, ms });
  }

  skipReveal(): void {
    // The host paces the match.
  }

  /** A request: the host checks and rate-limits it before applying it to its own field. */
  sendTypingAttack(count: number): void {
    if (this.snapshot.phase !== 'playing' || !this.snapshot.typing) return;
    this.transport.send({ type: 'typingAttack', count: count >= 2 ? 2 : 1 });
  }

  reportTypingDone(reason: 'dead' | 'race', milestone: number): void {
    if (this.snapshot.phase === 'playing' && this.snapshot.typing) this.transport.send({ type: 'typingDone', reason, milestone });
  }
}
