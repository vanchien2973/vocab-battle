import type { GameState } from '../game/types';

export const PROTOCOL_VERSION = 1;

/** Messages exchanged between host (authoritative) and guest. */
export type Message =
  /** guest → host, right after connecting */
  | { type: 'hello'; name: string; version: number }
  /** host → guest: both players' names */
  | { type: 'lobby'; hostName: string; guestName: string }
  /** host → guest: host is (re)choosing the word set; readiness is reset */
  | { type: 'selecting' }
  /** host → guest: the chosen word set; both sides move to the preview step */
  | { type: 'wordset'; wordIds: string[] }
  /** guest → host: guest toggled "Sẵn sàng" */
  | { type: 'ready'; ready: boolean }
  /** host → guest: readiness of both sides */
  | { type: 'readyState'; host: boolean; guest: boolean }
  /** host → guest: both ready, the match starts after this many seconds */
  | { type: 'countdown'; seconds: number }
  /** host → guest: authoritative game state (correct answer hidden while a question is open) */
  | { type: 'state'; state: GameState }
  /** guest → host: answer timed on the guest's own device */
  | { type: 'answer'; questionId: string; answerIndex: number | null; ms: number }
  /** either side is leaving the room */
  | { type: 'leave' };

export type MessageType = Message['type'];

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Validate untrusted data received from the peer. */
export function isMessage(data: unknown): data is Message {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case 'hello':
      return isStr(m.name) && isNum(m.version);
    case 'lobby':
      return isStr(m.hostName) && isStr(m.guestName);
    case 'selecting':
    case 'leave':
      return true;
    case 'wordset':
      return Array.isArray(m.wordIds) && m.wordIds.every(isStr);
    case 'ready':
      return isBool(m.ready);
    case 'readyState':
      return isBool(m.host) && isBool(m.guest);
    case 'countdown':
      return isNum(m.seconds);
    case 'state':
      return typeof m.state === 'object' && m.state !== null;
    case 'answer':
      return isStr(m.questionId) && (m.answerIndex === null || isNum(m.answerIndex)) && isNum(m.ms);
    default:
      return false;
  }
}
