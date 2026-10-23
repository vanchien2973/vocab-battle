export const MAX_WORD_LENGTH = 40;

/** Mirrors LookupService.NormalizeWord on the server. Kept free of heavy imports: the word catalog uses it. */
export function normalizeWord(input: string): string | null {
  const word = input.trim().replace(/\s+/g, ' ').toLowerCase();
  return word.length > 0 && word.length <= MAX_WORD_LENGTH && /^\p{L}[\p{L}' -]*$/u.test(word) ? word : null;
}
