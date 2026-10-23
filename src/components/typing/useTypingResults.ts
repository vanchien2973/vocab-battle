import { useCallback } from 'react';
import { useData } from '../../decks/DataContext';
import { applyBattleReviews } from '../../study/battleProgress';
import { typingReviews } from '../../typing/progress';
import type { TypingResultData } from './TypingPlay';

/**
 * After a game: update FSRS for items from the player's decks and save the session (score, WPM,
 * accuracy) to progress, in Cosmos when signed in or IndexedDB otherwise.
 */
export function useTypingResults() {
  const data = useData();
  return useCallback(
    (r: TypingResultData) => {
      if (r.outcomes.length === 0) return;
      const reviews = typingReviews(r.outcomes, r.content);
      if (reviews.length) void applyBattleReviews(reviews, data.loadProgress, data.queue).catch(() => undefined);
      void data.queue.recordTyping({
        at: new Date().toISOString(),
        score: r.score,
        wpm: Math.round(r.wpm * 10) / 10,
        accuracy: Math.round(r.accuracy * 1000) / 1000,
        milestone: r.milestone,
        content: r.content,
        mode: r.mode,
      });
    },
    [data],
  );
}
