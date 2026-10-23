import { emptyItem, type Item } from '../decks/types';
import { TOPIC_LABELS } from './config';
import type { UsefulPhrase } from './types';

/** Useful phrases from a graded essay as deck items (right type, with the example), ready for flashcards/battle/typing. */
export function phrasesToItems(phrases: readonly UsefulPhrase[], topic: string): Item[] {
  return phrases.map((p) =>
    emptyItem(p.type, {
      text: p.text,
      meaning: p.meaningVi,
      examples: p.example ? [{ en: p.example, vi: '' }] : [],
      tags: ['vstep-writing', ...(topic && topic !== 'custom' ? [topic] : [])],
    }),
  );
}

/** Name for a new deck made from these phrases: "VSTEP Writing – Môi trường". */
export const phraseDeckName = (topic: string) => `VSTEP Writing – ${TOPIC_LABELS[topic] ?? 'Đề tự nhập'}`;
