import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { migrateDeck } from './migrate';
import { emptyItem, LIMITS, newDeck, type Deck, type Item } from './types';

export interface ImportLine {
  line: number;
  item?: Item;
  error?: string;
}

/** Split one CSV line (RFC 4180 quotes: "a, b" and "" for a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function toItem(word: string, meaning: string, example = ''): Item | string {
  const f = LIMITS.fieldLength;
  if (!word) return 'Thiếu từ.';
  if (!meaning) return 'Thiếu nghĩa.';
  if (word.length > f.text) return `Từ dài quá ${f.text} ký tự.`;
  if (meaning.length > f.meaning) return `Nghĩa dài quá ${f.meaning} ký tự.`;
  if (example.length > f.example) return `Ví dụ dài quá ${f.example} ký tự.`;
  // Several words → most likely a phrase; the player can change the type in the preview.
  const type = word.trim().split(/\s+/).length > 1 ? 'collocation' : 'word';
  return emptyItem(type, { text: word, meaning, examples: example ? [{ en: example, vi: '' }] : [] });
}

/**
 * "word - nghĩa" lines (also "–", tab, ":" or "=" as separator) or CSV `word,meaning,example`.
 * A CSV header row (word,meaning…) is skipped. Every non-empty line gives an item or an error.
 */
export function parseImport(text: string, format: 'lines' | 'csv'): ImportLine[] {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: ImportLine[] = [];
  rows.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let result: Item | string;
    if (format === 'csv') {
      const [word = '', meaning = '', example = ''] = splitCsvLine(line);
      if (i === 0 && /^(word|từ|text)$/i.test(word)) return;
      result = toItem(word, meaning, example);
    } else {
      const m = /^(.+?)\s*(?:\s[-–—]\s|\t|\s*[:=]\s*)\s*(.+)$/.exec(line);
      result = m ? toItem(m[1].trim(), m[2].trim()) : 'Không tìm thấy dấu phân cách " - " giữa từ và nghĩa.';
    }
    out.push(typeof result === 'string' ? { line: i + 1, error: result } : { line: i + 1, item: result });
  });
  return out;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function exportCsv(deck: Deck): string {
  const rows = [['word', 'meaning', 'example', 'type', 'example_vi', 'ipa', 'note']];
  for (const it of deck.items) rows.push([it.text, it.meaning, it.examples[0]?.en ?? '', it.type, it.examples[0]?.vi ?? '', it.ipa ?? '', it.note ?? '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Portable JSON: no ids that matter to the source account. */
export function exportJson(deck: Deck): string {
  const { name, description, level, items, schemaVersion } = deck;
  return JSON.stringify({ name, description, level, schemaVersion, items }, null, 2);
}

/** Import a deck exported as JSON (current or v1 shape). New id, so it never overwrites a deck. */
export function importJson(text: string): Deck {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tệp JSON không phải bộ từ.');
  const d = migrateDeck(raw as Record<string, unknown>);
  return newDeck(d.name, { description: d.description, level: d.level, items: d.items });
}

// ---------- share links ----------

/** Compact link payload for signed-out sharing (`?deck=`): no ids, no distractors. */
export function encodeDeckLink(deck: Deck): string {
  const compact = {
    n: deck.name,
    d: deck.description,
    l: deck.level,
    i: deck.items.map((it) => [it.type, it.text, it.meaning, it.examples.map((e) => [e.en, e.vi]), it.ipa ?? '', it.note ?? '']),
  };
  return compressToEncodedURIComponent(JSON.stringify(compact));
}

export function decodeDeckLink(encoded: string): Deck | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const c = JSON.parse(json) as { n?: string; d?: string; l?: string; i?: unknown[] };
    if (!Array.isArray(c.i)) return null;
    const items = c.i.filter(Array.isArray).map((row) => {
      const [type, text, meaning, examples, ipa, note] = row as [string, string, string, [string, string][], string, string];
      return {
        type,
        text,
        meaning,
        examples: Array.isArray(examples) ? examples.map((e) => ({ en: e?.[0], vi: e?.[1] })) : [],
        ipa,
        note,
      };
    });
    const d = migrateDeck({ name: c.n, description: c.d, level: c.l, schemaVersion: 2, items });
    return newDeck(d.name, { description: d.description, level: d.level, items: d.items });
  } catch {
    return null;
  }
}

export function deckLink(deck: Deck, origin = window.location.origin): string {
  return `${origin}/?deck=${encodeDeckLink(deck)}`;
}

export const isLinkTooLong = (url: string) => url.length > LIMITS.deckLinkWarnLength;

// ---------- short share codes (signed in) ----------

async function jsonOrError(res: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // ignore
  }
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Máy chủ gặp lỗi (HTTP ${res.status}).`);
  return data;
}

/** POST /api/shares → 8-character code valid for 30 days. */
export async function createShareCode(deckId: string): Promise<{ code: string; expiresAt: string }> {
  const res = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deckId }) });
  const data = await jsonOrError(res);
  return { code: String(data.code), expiresAt: String(data.expiresAt) };
}

/** GET /api/shares/{code} (public). */
export async function fetchSharedDeck(code: string): Promise<Deck> {
  const data = await jsonOrError(await fetch(`/api/shares/${encodeURIComponent(code)}`));
  const d = migrateDeck((data.deck ?? {}) as Record<string, unknown>);
  return newDeck(d.name, { description: d.description, level: d.level, items: d.items });
}

export const shareCodeLink = (code: string, origin = window.location.origin) => `${origin}/?share=${code}`;
