import type { Message } from './protocol';

/**
 * connecting: setting up / dialing · waiting: host is online, no guest yet ·
 * connected: peer link open · disconnected: link closed · error: could not connect.
 */
export type ConnectionStatus = 'connecting' | 'waiting' | 'connected' | 'disconnected' | 'error';

/**
 * Point-to-point link between the two players. Game/session code only depends on this
 * interface, so PeerJS can be swapped for Supabase Realtime, SignalR, etc.
 */
export interface GameTransport {
  readonly status: ConnectionStatus;
  /** Human-readable reason when status is 'error'. */
  readonly error: string | null;
  send(msg: Message): void;
  onMessage(cb: (msg: Message) => void): () => void;
  onStatus(cb: (status: ConnectionStatus, error: string | null) => void): () => void;
  close(): void;
}

/** Listener bookkeeping shared by transport implementations. */
export abstract class BaseTransport implements GameTransport {
  status: ConnectionStatus = 'connecting';
  error: string | null = null;
  private messageListeners = new Set<(msg: Message) => void>();
  private statusListeners = new Set<(status: ConnectionStatus, error: string | null) => void>();

  abstract send(msg: Message): void;
  abstract close(): void;

  onMessage(cb: (msg: Message) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus, error: string | null) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  protected emitMessage(msg: Message): void {
    for (const cb of [...this.messageListeners]) cb(msg);
  }

  protected setStatus(status: ConnectionStatus, error: string | null = null): void {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    for (const cb of [...this.statusListeners]) cb(status, error);
  }

  protected clearListeners(): void {
    this.messageListeners.clear();
    this.statusListeners.clear();
  }
}
