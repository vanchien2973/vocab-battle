import type { Example, Item } from '../decks/types';

export const BLANK = '_____';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex source for an English word plus its common inflections (-s, -es, -ed, -ing, y→ies/ied). */
function inflected(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return escape(w);
  if (w.endsWith('e')) return `${escape(w.slice(0, -1))}(?:e|es|ed|ing)`;
  if (/[^aeiou]y$/.test(w)) return `${escape(w.slice(0, -1))}(?:y|ies|ied|ying)`;
  // Doubled final consonant: stop → stopped/stopping.
  const doubled = /[^aeiou][aeiou][bdgmnprt]$/.test(w) ? `|${escape(w + w[w.length - 1])}(?:ed|ing)` : '';
  return `(?:${escape(w)}(?:s|es|ed|ing)?${doubled})`;
}

/**
 * Where the item's text appears in a sentence (case-insensitive, whole words). The first word may
 * be inflected ("look into" matches "looked into"); placeholders like "sb"/"sth" match one word.
 */
export function findInSentence(sentence: string, text: string): { start: number; end: number } | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const parts = tokens.map((t, i) => {
    if (/^(sb|sth|someone|something|one's|somebody)$/i.test(t)) return "[\\w'’]+";
    return i === 0 ? inflected(t) : escape(t.toLowerCase());
  });
  const re = new RegExp(`(?<![\\w'’])${parts.join('\\s+')}(?![\\w'’])`, 'i');
  const m = re.exec(sentence);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export interface Cloze {
  /** Sentence with the item replaced by BLANK. */
  sentence: string;
  /** The exact words that were removed (may be inflected). */
  answer: string;
  example: Example;
}

/** A cloze from the first example that contains the item's text, or null when none does. */
export function makeCloze(item: Pick<Item, 'text' | 'examples'>, exampleIndex?: number): Cloze | null {
  const order = exampleIndex === undefined ? item.examples : [item.examples[exampleIndex], ...item.examples].filter(Boolean);
  for (const ex of order) {
    const pos = findInSentence(ex.en, item.text);
    if (pos) {
      return { sentence: ex.en.slice(0, pos.start) + BLANK + ex.en.slice(pos.end), answer: ex.en.slice(pos.start, pos.end), example: ex };
    }
  }
  return null;
}

export const canCloze = (item: Pick<Item, 'text' | 'examples'>) => makeCloze(item) !== null;

/** Typed answers: ignore case, extra spaces and trailing punctuation. */
export function sameAnswer(typed: string, expected: string): boolean {
  const n = (s: string) => s.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
  return n(typed) !== '' && n(typed) === n(expected);
}
