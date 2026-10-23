import Dexie, { type Table } from 'dexie';
import type { DeckProgress, ProgressBatch } from '../study/fsrs';
import type { WritingDraft } from '../vstep/drafts';
import type { WritingRecord, WritingStats } from '../vstep/types';
import { migrateDeck } from './migrate';
import type { Deck } from './types';

/** A progress batch that still has to reach the API (offline or failed). */
export interface PendingBatch {
  seq?: number;
  /** "" for local (signed-out) progress, otherwise the signed-in user's id. */
  userId: string;
  deckId: string;
  batch: ProgressBatch;
  createdAt: string;
}

export const DB_NAME = 'vocab-battle';

/**
 * Local storage for signed-out players (and the offline progress queue).
 * v1 stored decks with `words[]`; v2 upgrades them to `items[]` (same migration as the API).
 */
export class VocabDb extends Dexie {
  decks!: Table<Deck, string>;
  progress!: Table<DeckProgress, string>;
  pending!: Table<PendingBatch, number>;
  writings!: Table<WritingRecord, string>;
  writingDrafts!: Table<WritingDraft, string>;
  writingStats!: Table<WritingStats & { id: string }, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({ decks: 'id, updatedAt', progress: 'deckId' });
    this.version(2)
      .stores({ decks: 'id, updatedAt', progress: 'deckId', pending: '++seq, userId, deckId' })
      .upgrade((tx) =>
        tx
          .table('decks')
          .toCollection()
          .modify((deck: Record<string, unknown>) => {
            const migrated = migrateDeck(deck);
            for (const k of Object.keys(deck)) delete deck[k];
            Object.assign(deck, migrated);
          }),
      );
    // v3: VSTEP writing history, the current draft and error totals (signed-out players).
    this.version(3).stores({ writings: 'id, createdAt, promptId', writingDrafts: 'id', writingStats: 'id' });
  }
}

let db: VocabDb | null = null;

/** The shared database; null when IndexedDB is unavailable (some private modes). */
export function getDb(): VocabDb | null {
  if (db) return db;
  try {
    if (typeof indexedDB === 'undefined') return null;
    db = new VocabDb();
    return db;
  } catch {
    return null;
  }
}

/** Offline queue of progress batches, kept in IndexedDB so they survive a reload. */
export class DexiePendingStore {
  constructor(private readonly db: VocabDb) {}
  add(p: PendingBatch): Promise<number> {
    return this.db.pending.add(p);
  }
  list(userId: string): Promise<PendingBatch[]> {
    return this.db.pending.where('userId').equals(userId).sortBy('seq');
  }
  remove(seq: number): Promise<void> {
    return this.db.pending.delete(seq);
  }
}
