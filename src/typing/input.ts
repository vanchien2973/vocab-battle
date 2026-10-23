/**
 * Keyboard input helpers. Vietnamese IMEs (Telex/VNI) rewrite the characters just typed ("aa" → "â"),
 * so the hidden input is compared with its previous value instead of trusting key events, and every
 * character is folded to plain lowercase ASCII-ish letters before it reaches the game.
 */

/** Lowercase, without diacritics; curly apostrophes become "'". */
export function normalizeChar(ch: string): string {
  return ch
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

/** An answer as players type it: normalized, single spaces, trimmed. */
export function normalizeAnswer(text: string): string {
  return normalizeChar(text).replace(/\s+/g, ' ').trim();
}

/** Characters with Vietnamese diacritics mean an IME is on. */
export function looksVietnameseIme(raw: string): boolean {
  return /[^\u0000-\u007f]/.test(raw) && normalizeChar(raw) !== raw.toLowerCase();
}

/**
 * Turn a change of the hidden input's value into key presses: characters removed from the end become
 * backspaces, new characters are typed (normalized). An IME replacing "a" with "â" yields
 * one backspace and "a".
 */
export function diffInput(prev: string, next: string): { backspaces: number; chars: string[] } {
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev[p] === next[p]) p++;
  const chars = [...next.slice(p)].map(normalizeChar).flatMap((c) => [...c]);
  return { backspaces: prev.length - p, chars };
}
