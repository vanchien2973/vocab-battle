import { loadMyWords } from '../ai/myWords';
import { ALL_WORDS, type Word } from './words';

/** Built-in words followed by the player's saved words ("Của tôi"). Read fresh, since saved words can change. */
export function catalogWords(): Word[] {
  return [...ALL_WORDS, ...loadMyWords()];
}

/** Resolve ids against the full catalog, dropping unknown ids and keeping order. */
export function resolveWords(ids: readonly string[], catalog: readonly Word[] = catalogWords()): Word[] {
  const byId = new Map(catalog.map((w) => [w.id, w]));
  return ids.map((id) => byId.get(id)).filter((w): w is Word => w !== undefined);
}
