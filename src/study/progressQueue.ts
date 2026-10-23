import type { PendingBatch } from '../decks/db';
import { isRetryable, type ProgressRepository } from '../decks/repository';
import type { ItemType } from '../decks/types';
import { countReview, dayKey, TYPING_PROGRESS_ID, type Grade, type ProgressBatch, type StoredCard, type TypingSession } from './fsrs';

/** Persistent store for batches that could not be sent yet (IndexedDB in the app, memory in tests). */
export interface PendingStore {
  add(p: PendingBatch): Promise<number>;
  list(userId: string): Promise<PendingBatch[]>;
  remove(seq: number): Promise<void>;
}

export const FLUSH_EVERY = 10;

/**
 * Collects reviews and writes them in batches (every 10 cards and at the end of a session) to save
 * request units. Batches that fail because of the network are kept in the pending store and retried
 * when the browser comes back online or on the next flush.
 */
export class ProgressQueue {
  private batches = new Map<string, ProgressBatch>();
  private count = 0;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly repo: ProgressRepository,
    private readonly pending: PendingStore,
    /** "" when signed out. */
    private readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Record one answer; flushes automatically every FLUSH_EVERY answers. */
  record(deckId: string, key: string, card: StoredCard, itemType: ItemType, grade: Grade, wasNew: boolean): Promise<void> {
    const b = this.batches.get(deckId) ?? { cards: {}, days: {} };
    b.cards[key] = card;
    const day = dayKey(this.now());
    b.days[day] = countReview(b.days[day], itemType, grade, wasNew);
    this.batches.set(deckId, b);
    this.count++;
    return this.count >= FLUSH_EVERY ? this.flush() : Promise.resolve();
  }

  /** Save a finished typing game in the "_typing" document (sent right away, queued when offline). */
  recordTyping(session: TypingSession): Promise<void> {
    const b = this.batches.get(TYPING_PROGRESS_ID) ?? { cards: {}, days: {} };
    b.typing = [...(b.typing ?? []), session];
    this.batches.set(TYPING_PROGRESS_ID, b);
    return this.flush();
  }

  get unsaved(): number {
    return this.count;
  }

  /** Send everything collected plus earlier pending batches. Never throws; failures stay queued. */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
      // Something recorded while sending: send it too.
      if (this.batches.size) void this.flush();
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const fresh = [...this.batches];
    this.batches = new Map();
    this.count = 0;
    // Persist first so nothing is lost if the tab closes mid-request.
    for (const [deckId, batch] of fresh) {
      await this.pending.add({ userId: this.userId, deckId, batch, createdAt: this.now().toISOString() });
    }
    for (const p of await this.pending.list(this.userId)) {
      try {
        await this.repo.merge(p.deckId, p.batch);
        await this.pending.remove(p.seq!);
      } catch (e) {
        if (isRetryable(e)) break; // offline: keep the rest for later, in order
        await this.pending.remove(p.seq!); // rejected (e.g. deck deleted): drop it
      }
    }
  }
}

export class MemoryPendingStore implements PendingStore {
  private items: PendingBatch[] = [];
  private seq = 0;
  async add(p: PendingBatch) {
    const seq = ++this.seq;
    this.items.push({ ...p, seq });
    return seq;
  }
  async list(userId: string) {
    return this.items.filter((p) => p.userId === userId);
  }
  async remove(seq: number) {
    this.items = this.items.filter((p) => p.seq !== seq);
  }
}
