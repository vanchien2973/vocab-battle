import type { BattleItem } from '../data/words';
import type { BattleReview } from '../study/battleProgress';
import { Rating, type CardType } from '../study/fsrs';
import type { ContentKind, Outcome } from './types';

/** The FSRS card each content kind trains. */
export const CARD_FOR_CONTENT: Record<ContentKind, CardType> = {
  copy: 'en-vi',
  meaning: 'vi-en',
  listen: 'listen',
  cloze: 'cloze',
};

const GRADE: Record<Outcome, BattleReview['grade']> = { clean: Rating.Good, assisted: Rating.Hard, missed: Rating.Again };

/**
 * Typing results as FSRS reviews: typed right first time = Good, right after mistakes or hints = Hard,
 * let through = Again. Only items from the player's decks; built-in words are skipped.
 */
export function typingReviews(outcomes: readonly { item: BattleItem; outcome: Outcome }[], content: ContentKind): BattleReview[] {
  return outcomes
    .filter((o) => o.item.deckId)
    .map(({ item, outcome }) => ({
      deckId: item.deckId!,
      itemId: item.sourceId ?? item.id,
      type: item.type,
      grade: GRADE[outcome],
      // A cloze item that had no matching example was asked as "meaning".
      cardType: content === 'cloze' ? 'cloze' : CARD_FOR_CONTENT[content],
    }));
}
