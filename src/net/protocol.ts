import type { BattleItem } from '../data/words';
import { ITEM_TYPES, LIMITS } from '../decks/types';
import { QUESTION_KINDS, type GameState, type QuestionKind } from '../game/types';

export const PROTOCOL_VERSION = 3;
/** Limits for item sets received from the peer. */
export const MAX_WORDSET = 300;
export const MAX_FIELD_LENGTH = 300;
/** Whole itemset message, serialized (PeerJS data channel). */
export const MAX_ITEMSET_CHARS = 1_000_000;

/** Messages exchanged between host (authoritative) and guest. */
export type Message =
  /** guest → host, right after connecting */
  | { type: 'hello'; name: string; version: number }
  /** host → guest: both players' names */
  | { type: 'lobby'; hostName: string; guestName: string }
  /** host → guest: host is (re)choosing the word set; readiness is reset */
  | { type: 'selecting' }
  /** host → guest: the chosen items with their full content (words or phrases from the host's decks) and question kinds; both move to preview */
  | { type: 'itemset'; items: BattleItem[]; kinds: QuestionKind[] }
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
const isStrList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) && v.length <= maxItems && v.every((x) => isStr(x) && x.length <= maxLen);

/** A battle item from the peer: known type, bounded strings and lists (see LIMITS). */
export function isItemPayload(v: unknown): v is BattleItem {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  const f = LIMITS.fieldLength;
  const optional = (x: unknown, max: number) => x === undefined || (isStr(x) && x.length <= max);
  const d = w.distractors as Record<string, unknown> | undefined;
  const n = LIMITS.maxDistractorsPerList;
  return (
    isStr(w.id) &&
    w.id.length > 0 &&
    w.id.length <= f.id &&
    ITEM_TYPES.includes(w.type as never) &&
    isStr(w.text) &&
    w.text.trim() !== '' &&
    w.text.length <= f.text &&
    isStr(w.meaning) &&
    w.meaning.trim() !== '' &&
    w.meaning.length <= f.meaning &&
    Array.isArray(w.examples) &&
    w.examples.length <= LIMITS.maxExamplesPerItem &&
    w.examples.every((e: Record<string, unknown>) => !!e && isField(e.en) && isField(e.vi)) &&
    isStrList(w.tags, LIMITS.maxTagsPerItem, f.tag) &&
    optional(w.ipa, f.ipa) &&
    optional(w.partOfSpeech, f.partOfSpeech) &&
    optional(w.note, f.note) &&
    optional(w.relatedTo, f.id) &&
    (w.level === undefined || WORD_LEVELS.includes(w.level as string)) &&
    w.deckId === undefined &&
    w.sourceId === undefined &&
    (d === undefined ||
      (typeof d === 'object' &&
        d !== null &&
        isStrList(d.wrongCollocations, n, f.text) &&
        isStrList(d.wrongParticles, n, 20) &&
        isStrList(d.wrongSentences, n, f.example)))
  );
}

export const isKinds = (v: unknown): v is QuestionKind[] =>
  Array.isArray(v) && v.length > 0 && v.length <= QUESTION_KINDS.length && v.every((k) => QUESTION_KINDS.includes(k));

/** What the guest receives: no deck or source ids (they are the host's). */
export function itemsForPeer(items: readonly BattleItem[]): BattleItem[] {
  return items.map(({ deckId, sourceId, ...rest }) => {
    void deckId;
    void sourceId;
    return rest;
  });
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
    case 'itemset':
      return Array.isArray(m.items) && m.items.length <= MAX_WORDSET && m.items.every(isItemPayload) && isKinds(m.kinds);
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
