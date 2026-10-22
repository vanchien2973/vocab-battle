import type { MatchLike } from '../game/match';
import { defaultRng, randomInt, type Rng } from '../game/rng';
import type { PlayerId, Question } from '../game/types';
import type { PlayerController } from './types';

export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_ACCURACY: Record<BotLevel, number> = { easy: 0.5, normal: 0.75, hard: 0.92 };
export const BOT_MIN_DELAY_MS = 2000;
export const BOT_MAX_DELAY_MS = 5000;

export interface BotDecision {
  answerIndex: number;
  delayMs: number;
}

/** Pure: how and when the bot answers a question. */
export function decideBotAnswer(q: Question, level: BotLevel, rng: Rng): BotDecision {
  const delayMs = randomInt(rng, BOT_MIN_DELAY_MS, BOT_MAX_DELAY_MS);
  if (rng() < BOT_ACCURACY[level]) return { answerIndex: q.correctIndex, delayMs };
  const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correctIndex);
  return { answerIndex: wrong[Math.floor(rng() * wrong.length)], delayMs };
}

/** Answers each new question after a random 2–5 s delay. */
export function createBotController(level: BotLevel, rng: Rng = defaultRng): PlayerController {
  return {
    attach(match: MatchLike, playerId: PlayerId) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let answeredId: string | null = null;
      const onState = () => {
        const { phase, question } = match.state;
        if (phase !== 'question' || !question || question.id === answeredId) return;
        answeredId = question.id;
        const { answerIndex, delayMs } = decideBotAnswer(question, level, rng);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => match.submit(playerId, question.id, answerIndex, delayMs), delayMs);
      };
      const unsubscribe = match.subscribe(onState);
      onState();
      return () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
      };
    },
  };
}
