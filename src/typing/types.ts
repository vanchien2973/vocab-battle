import type { BattleItem } from '../data/words';
import type { Rng } from '../game/rng';

/** What a falling card shows and what must be typed. */
export const CONTENT_KINDS = ['copy', 'meaning', 'listen', 'cloze'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const CONTENT_LABELS: Record<ContentKind, string> = {
  copy: 'Gõ lại',
  meaning: 'Nghĩa → Anh',
  listen: 'Nghe',
  cloze: 'Cloze',
};

/** One item prepared for a content kind (cloze falls back to meaning when no example contains the item). */
export interface TypingTarget {
  item: BattleItem;
  kind: ContentKind;
  /** Text on the card (empty for listening cards). */
  display: string;
  /** Exactly what must be typed, normalized (lowercase, no diacritics, single spaces). */
  answer: string;
}

export type Outcome = 'clean' | 'assisted' | 'missed';

/** A pooled falling card; inactive ones are reused, nothing is allocated per frame. */
export interface TypingCard {
  active: boolean;
  /** Increases with every spawn: lets the renderer/speech notice a new card in a reused slot. */
  serial: number;
  target: number;
  x: number;
  /** 0 = top, 1 = bottom line. */
  y: number;
  speed: number;
  typed: number;
  mistakes: number;
  hints: number;
  attack: boolean;
  /** Seconds left of the "wrong key" shake. */
  shake: number;
}

export type FieldEventType = 'type' | 'wrong' | 'kill' | 'miss' | 'hint' | 'spawn' | 'milestone';

export interface FieldEvent {
  type: FieldEventType;
  x: number;
  y: number;
  /** Card slot, or -1. */
  card: number;
}

export interface FieldState {
  targets: TypingTarget[];
  cards: TypingCard[];
  /** Locked card slot, or -1. */
  locked: number;
  score: number;
  combo: number;
  maxCombo: number;
  hearts: number;
  /** Sequence cards hit or missed; drives milestones. */
  resolved: number;
  milestone: number;
  keys: { correct: number; total: number };
  /** Correctly typed characters (for WPM). */
  chars: number;
  /** Seconds of play. */
  elapsed: number;
  spawnTimer: number;
  order: number[];
  orderPos: number;
  lastTarget: number;
  /** Worst outcome per target index. */
  outcomes: Map<number, Outcome>;
  /** Attack cards earned and not yet sent to the opponent. */
  outbox: number;
  events: FieldEvent[];
  over: 'dead' | 'cleared' | null;
  maxActiveCap: number;
  serial: number;
  spawnRng: Rng;
  attackRng: Rng;
}
