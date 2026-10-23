import { create } from 'zustand';
import { readJSON, writeJSON } from '../storage/safeStorage';

const MUTE_KEY = 'vocab-battle.typing.muted.v1';

/** Mini view of the opponent's field: [x, y, attack] per card. */
export type MiniCard = [number, number, 0 | 1];

export interface OpponentView {
  name: string;
  score: number;
  milestone: number;
  hearts: number;
  combo: number;
  wpm: number;
  cards: MiniCard[];
}

/** What React shows around the canvas; the game loop pushes it ~10×/s. */
export interface TypingHud {
  score: number;
  milestone: number;
  hearts: number;
  combo: number;
  wpm: number;
  accuracy: number;
  paused: boolean;
  muted: boolean;
  imeWarning: boolean;
  focusWarning: boolean;
  opponent: OpponentView | null;
  /** Text shown on the falling cards, bottom-most first (for screen readers). */
  visible: string[];
}

export const useTypingHud = create<TypingHud>(() => ({
  score: 0,
  milestone: 1,
  hearts: 3,
  combo: 0,
  wpm: 0,
  accuracy: 1,
  paused: false,
  muted: readJSON<boolean>(MUTE_KEY, false) === true,
  imeWarning: false,
  focusWarning: false,
  opponent: null,
  visible: [],
}));

export function setMuted(muted: boolean) {
  writeJSON(MUTE_KEY, muted);
  useTypingHud.setState({ muted });
}
