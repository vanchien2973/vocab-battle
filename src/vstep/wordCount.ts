/**
 * VSTEP-style word count (same rule as WritingText.CountWords in the API): split on whitespace and
 * en/em dashes; a token counts when it has a letter or digit. So "well-known", "don't", "students'",
 * "2,000" and "3.5%" are one word each, and stray punctuation ("-", "...") counts as none.
 */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.replace(/[–—]/g, ' ').split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n++;
  }
  return n;
}

/** Collapse whitespace, for hashing and comparing prompts. */
export const normalizeSpace = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Stable id of a prompt text (first 16 hex chars of SHA-256 of the whitespace-normalized text),
 * the same as the API computes, so attempts at the same prompt can be compared.
 */
export async function promptIdOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSpace(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
