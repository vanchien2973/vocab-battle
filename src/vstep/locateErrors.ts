import type { WritingError } from './types';

export interface ErrorSpan {
  start: number;
  end: number;
  /** Index into the errors array. */
  index: number;
}

export interface Located {
  /** Non-overlapping spans sorted by start. */
  spans: ErrorSpan[];
  /** Indices of errors that could not be placed in the text ("lỗi chung"). */
  general: number[];
}

/** Lowercase, straight quotes, dashes as "-"; one char in, one char out, so indices still match the text. */
const foldChar = (c: string) => {
  if (/[‘’‛′`]/.test(c)) return "'";
  if (/[“”‟″]/.test(c)) return '"';
  if (/[‐-―]/.test(c)) return '-';
  if (/\s/.test(c)) return ' ';
  return c.toLowerCase();
};

/**
 * Text folded for matching plus a map back to the original indices: whitespace runs collapse to one
 * space, so a quote copied with different line breaks or double spaces still matches.
 */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = foldChar(text[i]);
    if (c === ' ' && folded.endsWith(' ')) continue;
    folded += c;
    map.push(i);
  }
  return { folded, map };
}

function nthIndex(haystack: string, needle: string, n: number): number {
  let from = 0;
  for (let k = 1; ; k++) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return -1;
    if (k === n) return i;
    from = i + 1;
  }
}

/** Where the n-th occurrence of `quote` is: exact first, then case/quote/space-insensitive; null when absent. */
export function findQuote(text: string, quote: string, occurrence = 1): { start: number; end: number } | null {
  const q = quote.trim();
  if (!q) return null;
  const n = Math.max(1, Math.floor(occurrence));
  const exact = nthIndex(text, q, n);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  const t = fold(text);
  const fq = fold(q).folded.trim();
  if (!fq) return null;
  let i = nthIndex(t.folded, fq, n);
  // The model sometimes miscounts occurrences: fall back to the only/first match.
  if (i < 0 && n > 1) i = nthIndex(t.folded, fq, 1);
  if (i < 0) return null;
  return { start: t.map[i], end: t.map[i + fq.length - 1] + 1 };
}

/**
 * Place each error in the essay by quote + occurrence. Errors that are not found, or that overlap an
 * error placed earlier (major ones are placed first), go to the general list instead of being dropped.
 */
export function locateErrors(text: string, errors: readonly WritingError[]): Located {
  const order = errors.map((_, i) => i).sort((a, b) => Number(errors[b].severity === 'major') - Number(errors[a].severity === 'major') || a - b);
  const spans: ErrorSpan[] = [];
  const general: number[] = [];
  for (const index of order) {
    const found = findQuote(text, errors[index].quote, errors[index].occurrence);
    if (!found || spans.some((s) => found.start < s.end && s.start < found.end)) general.push(index);
    else spans.push({ ...found, index });
  }
  spans.sort((a, b) => a.start - b.start);
  general.sort((a, b) => a - b);
  return { spans, general };
}

/** Split the text into plain and error segments for rendering. */
export function segments(text: string, spans: readonly ErrorSpan[]): { text: string; index: number | null }[] {
  const out: { text: string; index: number | null }[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), index: null });
    out.push({ text: text.slice(s.start, s.end), index: s.index });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), index: null });
  return out;
}
