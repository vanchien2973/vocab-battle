// Kept apart from importExport so the main bundle does not pull in lz-string.

/** ?share=CODE or ?deck=… in the current URL. */
export function sharedFromSearch(search: string): { kind: 'code'; code: string } | { kind: 'data'; data: string } | null {
  const p = new URLSearchParams(search);
  const code = p.get('share');
  if (code && /^[23456789A-Za-z]{8}$/.test(code)) return { kind: 'code', code: code.toUpperCase() };
  const data = p.get('deck');
  // lz-string's URI alphabet contains '+', which URLSearchParams decodes as a space.
  return data ? { kind: 'data', data: data.replace(/ /g, '+') } : null;
}
