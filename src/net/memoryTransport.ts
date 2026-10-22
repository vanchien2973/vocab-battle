import type { Message } from './protocol';
import { BaseTransport, type ConnectionStatus } from './transport';

/** In-memory transport for tests: messages are delivered synchronously to the other end. */
export class MemoryTransport extends BaseTransport {
  peer: MemoryTransport | null = null;
  sent: Message[] = [];
  closed = false;

  send(msg: Message): void {
    this.sent.push(msg);
    if (this.status === 'connected') this.peer?.receive(msg);
  }

  receive(msg: Message): void {
    if (!this.closed) this.emitMessage(msg);
  }

  set(status: ConnectionStatus, error: string | null = null): void {
    this.setStatus(status, error);
  }

  close(): void {
    this.closed = true;
    this.clearListeners();
    this.peer?.set('disconnected');
  }
}

/** A connected-able pair: call `connect()` to open both ends. */
export function createMemoryPair() {
  const host = new MemoryTransport();
  const guest = new MemoryTransport();
  host.peer = guest;
  guest.peer = host;
  host.set('waiting');
  return {
    host,
    guest,
    connect() {
      host.set('connected');
      guest.set('connected');
    },
  };
}
