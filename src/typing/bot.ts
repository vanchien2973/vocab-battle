import type { BotLevel } from '../controllers/bot';
import { mulberry32, type Rng } from '../game/rng';
import { pickTarget, typeChar } from './engine';
import type { FieldState } from './types';

/** Typing speed and accuracy per bot level. */
export const TYPING_BOT: Record<BotLevel, { wpm: number; accuracy: number }> = {
  easy: { wpm: 22, accuracy: 0.85 },
  normal: { wpm: 38, accuracy: 0.92 },
  hard: { wpm: 58, accuracy: 0.97 },
};

export interface TypingBot {
  wpm: number;
  accuracy: number;
  timer: number;
  rng: Rng;
}

export function createTypingBot(level: BotLevel, seed: number): TypingBot {
  const { wpm, accuracy } = TYPING_BOT[level];
  return { wpm, accuracy, timer: 1.2, rng: mulberry32(seed ^ 0x5bd1e995) };
}

const WRONG = 'qxzjv';

/** Type into the bot's own field at its WPM: one key every 60 / (wpm × 5) seconds, right with its accuracy. */
export function stepBot(bot: TypingBot, field: FieldState, dt: number) {
  if (field.over) return;
  bot.timer -= dt;
  const interval = 60 / (bot.wpm * 5);
  while (bot.timer <= 0) {
    bot.timer += interval * (0.7 + bot.rng() * 0.6);
    const slot = field.locked >= 0 ? field.locked : pickTarget(field, null);
    if (slot < 0) {
      bot.timer = Math.max(bot.timer, 0.2);
      return;
    }
    const card = field.cards[slot];
    const answer = field.targets[card.target].answer;
    const expected = answer[card.typed];
    if (bot.rng() < bot.accuracy) {
      // Lock the chosen card first so the bot does not jump to another card with the same first letter.
      if (field.locked < 0) field.locked = slot;
      typeChar(field, expected);
    } else {
      const wrong = [...WRONG].find((c) => c !== expected) ?? 'q';
      if (field.locked < 0) field.locked = slot;
      typeChar(field, wrong);
    }
  }
}
