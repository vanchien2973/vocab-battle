import type { BattleItem } from '../data/words';
import { ITEM_TYPES, LIMITS } from '../decks/types';
import { QUESTION_KINDS, type GameState, type QuestionKind } from '../game/types';
import { CONTENT_KINDS, type ContentKind } from '../typing/types';

/** Luyện Gõ online: both sides play the same seeded sequence of falling words. */
export interface TypingSetup {
  type: 'typing';
  seed: number;
  content: ContentKind;
  rule: 'hearts' | 'race';
}

/** Minimal view of a player's field (~5 per second): [x, y, attack] per card. */
export interface TypingStatus {
  score: number;
  milestone: number;
  hearts: number;
  combo: number;
  wpm: number;
  cards: [number, number, 0 | 1][];
}

export const MAX_STATUS_CARDS = 16;

export const PROTOCOL_VERSION = 4;
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
  | { type: 'itemset'; items: BattleItem[]; kinds: QuestionKind[]; game?: TypingSetup }
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
  /** host → guest: the typing match starts (after the countdown) */
  | { type: 'typingStart' }
  /** either side: own field, for the opponent's mini view */
  | ({ type: 'typingStatus' } & TypingStatus)
  /** host → guest: cards to add; guest → host: request, checked and rate-limited by the host */
  | { type: 'typingAttack'; count: 1 | 2 }
  /** guest → host: the guest's field ended (out of hearts, or passed milestone 20) */
  | { type: 'typingDone'; reason: 'dead' | 'race'; milestone: number }
  /** host → guest: the host's decision */
  | { type: 'typingOver'; winner: 'p1' | 'p2'; reason: string }
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

export function isTypingSetup(v: unknown): v is TypingSetup {
  const g = v as Record<string, unknown>;
  return (
    typeof v === 'object' &&
    v !== null &&
    g.type === 'typing' &&
    isNum(g.seed) &&
    Number.isInteger(g.seed) &&
    g.seed >= 0 &&
    g.seed < 2 ** 32 &&
    CONTENT_KINDS.includes(g.content as ContentKind) &&
    (g.rule === 'hearts' || g.rule === 'race')
  );
}

const inRange = (v: unknown, lo: number, hi: number) => isNum(v) && v >= lo && v <= hi;

export function isTypingStatus(m: Record<string, unknown>): boolean {
  return (
    inRange(m.score, 0, 1e7) &&
    inRange(m.milestone, 1, 20) &&
    inRange(m.hearts, 0, 99) &&
    inRange(m.combo, 0, 1e5) &&
    inRange(m.wpm, 0, 1000) &&
    Array.isArray(m.cards) &&
    m.cards.length <= MAX_STATUS_CARDS &&
    m.cards.every((c) => Array.isArray(c) && c.length === 3 && inRange(c[0], 0, 1) && inRange(c[1], -0.1, 1.2) && (c[2] === 0 || c[2] === 1))
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
    case 'itemset':
      return (
        Array.isArray(m.items) && m.items.length <= MAX_WORDSET && m.items.every(isItemPayload) && isKinds(m.kinds) && (m.game === undefined || isTypingSetup(m.game))
      );
    case 'typingStart':
      return true;
    case 'typingStatus':
      return isTypingStatus(m);
    case 'typingAttack':
      return m.count === 1 || m.count === 2;
    case 'typingDone':
      return (m.reason === 'dead' || m.reason === 'race') && isNum(m.milestone) && m.milestone >= 0 && m.milestone <= 20;
    case 'typingOver':
      return (m.winner === 'p1' || m.winner === 'p2') && isStr(m.reason) && m.reason.length <= 100;
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
