import { readJSON, writeJSON } from '../storage/safeStorage';
import { normalizeWord } from './shared';
import type { LookupEntry } from './types';

const KEY = 'vocab-battle.lookup.v1';
export const MAX_CACHED = 200;

type Cache = Record<string, { entry: LookupEntry; at: number }>;

function load(): Cache {
  const c = readJSON<unknown>(KEY, {});
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Cache) : {};
}

/** Cached dictionary entry, so the same word never calls the API twice. */
export function getCachedLookup(word: string): LookupEntry | null {
  const key = normalizeWord(word);
  return key ? (load()[key]?.entry ?? null) : null;
}

export function cacheLookup(word: string, entry: LookupEntry, now = Date.now()): void {
  const key = normalizeWord(word);
  if (!key) return;
  const cache = load();
  cache[key] = { entry, at: now };
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHED) {
    keys
      .sort((a, b) => cache[a].at - cache[b].at)
      .slice(0, keys.length - MAX_CACHED)
      .forEach((k) => delete cache[k]);
  }
  writeJSON(KEY, cache);
}
