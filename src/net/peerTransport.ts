import Peer, { type DataConnection } from 'peerjs';
import { isMessage, type Message } from './protocol';
import { peerIdForRoom } from './roomCode';
import { BaseTransport, type GameTransport } from './transport';

export const CONNECT_TIMEOUT_MS = 15_000;

const TIMEOUT_ERROR = 'Không kết nối được sau 15 giây. Hãy thử mạng khác (ví dụ 4G hoặc Wi-Fi khác) — một số mạng chặn WebRTC.';

function describeError(type: string): string {
  switch (type) {
    case 'peer-unavailable':
      return 'Không tìm thấy phòng. Kiểm tra lại mã phòng hoặc nhờ chủ phòng tạo lại.';
    case 'unavailable-id':
      return 'Mã phòng đang được dùng, hãy tạo phòng khác.';
    case 'browser-incompatible':
      return 'Trình duyệt không hỗ trợ WebRTC.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Không kết nối được máy chủ. Hãy thử mạng khác.';
    default:
      return 'Kết nối thất bại. Hãy thử mạng khác.';
  }
}

/** PeerJS (WebRTC data channel) transport. One host, one guest. */
class PeerTransport extends BaseTransport {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private timeout: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(role: 'host' | 'guest', code: string) {
    super();
    this.timeout = setTimeout(() => this.fail(TIMEOUT_ERROR), CONNECT_TIMEOUT_MS);
    this.peer = role === 'host' ? new Peer(peerIdForRoom(code), { debug: 0 }) : new Peer({ debug: 0 });

    this.peer.on('open', () => {
      if (role === 'host') {
        clearTimeout(this.timeout);
        this.setStatus('waiting');
      } else {
        this.attach(this.peer.connect(peerIdForRoom(code), { reliable: true }));
      }
    });
    this.peer.on('connection', (conn) => {
      // Only one guest per room.
      if (this.conn) {
        conn.on('open', () => conn.close());
        return;
      }
      this.attach(conn);
    });
    this.peer.on('disconnected', () => {
      // Lost the signalling server; an established data channel keeps working.
      if (!this.closed && this.status !== 'connected') this.peer.reconnect();
    });
    this.peer.on('error', (err) => {
      if (this.status === 'connected') return;
      this.fail(describeError(err.type));
    });
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => {
      clearTimeout(this.timeout);
      this.setStatus('connected');
    });
    conn.on('data', (data) => {
      if (isMessage(data)) this.emitMessage(data);
    });
    conn.on('close', () => this.lost());
    conn.on('error', () => this.lost());
  }

  private lost(): void {
    if (this.closed) return;
    if (this.status === 'connected') this.setStatus('disconnected');
    this.conn = null;
  }

  private fail(error: string): void {
    if (this.closed || this.status === 'error') return;
    clearTimeout(this.timeout);
    this.setStatus('error', error);
    this.peer.destroy();
  }

  send(msg: Message): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timeout);
    this.clearListeners();
    // Give a final 'leave' message a moment to flush before tearing down.
    setTimeout(() => {
      this.conn?.close();
      this.peer.destroy();
    }, 200);
  }
}

export function hostRoom(code: string): GameTransport {
  return new PeerTransport('host', code);
}

export function joinRoom(code: string): GameTransport {
  return new PeerTransport('guest', code);
}
