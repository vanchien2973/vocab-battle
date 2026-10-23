export interface DiffToken {
  /** The word with its trailing whitespace. */
  text: string;
  changed: boolean;
}

const tokens = (s: string) => s.match(/\s*\S+\s*/g) ?? [];
const key = (t: string) => t.trim();

/**
 * Word-level diff for the side-by-side view: tokens of each text marked as changed when they are not
 * part of the longest common subsequence of words.
 */
export function wordDiff(before: string, after: string): { before: DiffToken[]; after: DiffToken[] } {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..], flattened.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] = key(a[i]) === key(b[j]) ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)]);
    }
  }
  const outA: DiffToken[] = [];
  const outB: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      outA.push({ text: a[i++], changed: false });
      outB.push({ text: b[j++], changed: false });
    } else if (lcs[at(i + 1, j)] >= lcs[at(i, j + 1)]) {
      outA.push({ text: a[i++], changed: true });
    } else {
      outB.push({ text: b[j++], changed: true });
    }
  }
  while (i < n) outA.push({ text: a[i++], changed: true });
  while (j < m) outB.push({ text: b[j++], changed: true });
  return { before: outA, after: outB };
}

/** Share of the rewrite's words that differ from the original (0–1). */
export const changeRatio = (d: { after: DiffToken[] }) => (d.after.length ? d.after.filter((t) => t.changed).length / d.after.length : 0);
