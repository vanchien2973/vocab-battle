import type { Word } from '../data/words';
import type { GameState } from '../game/types';

export const PROTOCOL_VERSION = 2;
/** Limits for word sets received from the peer. */
export const MAX_WORDSET = 300;
export const MAX_FIELD_LENGTH = 300;

/** Messages exchanged between host (authoritative) and guest. */
export type Message =
  /** guest → host, right after connecting */
  | { type: 'hello'; name: string; version: number }
  /** host → guest: both players' names */
  | { type: 'lobby'; hostName: string; guestName: string }
  /** host → guest: host is (re)choosing the word set; readiness is reset */
  | { type: 'selecting' }
  /** host → guest: the chosen words with their content (so saved "Của tôi" words work too); both move to preview */
  | { type: 'wordset'; words: Word[] }
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
const isField = (v: unknown): v is string => isStr(v) && v.length <= MAX_FIELD_LENGTH;
const WORD_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function isWordPayload(v: unknown): v is Word {
  const w = v as Record<string, unknown>;
  return (
    typeof v === 'object' &&
    v !== null &&
    isField(w.id) &&
    isField(w.word) &&
    w.word.trim() !== '' &&
    isField(w.meaning) &&
    w.meaning.trim() !== '' &&
    isField(w.example) &&
    WORD_LEVELS.includes(w.level as string)
  );
}

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
      return Array.isArray(m.words) && m.words.length <= MAX_WORDSET && m.words.every(isWordPayload);
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
