import { emptyProgress, mergeProgress, type DeckProgress, type ProgressBatch } from '../study/fsrs';
import type { VocabDb } from './db';
import { migrateDeck } from './migrate';
import { LIMITS, summarize, type Deck, type DeckSummary } from './types';

export class DeckError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DeckError';
  }
}

/** The deck was changed elsewhere (HTTP 412); `current` is the stored version. */
export class ConflictError extends DeckError {
  constructor(readonly current: Deck) {
    super('Bộ từ đã được sửa ở nơi khác.', 412);
    this.name = 'ConflictError';
  }
}

/** Where decks live: the API when signed in (Cosmos), IndexedDB otherwise. */
export interface DeckRepository {
  readonly kind: 'cloud' | 'local';
  list(): Promise<DeckSummary[]>;
  get(id: string): Promise<Deck>;
  create(deck: Deck): Promise<Deck>;
  /** Throws ConflictError when the deck changed since it was read (cloud only). */
  update(deck: Deck): Promise<Deck>;
  remove(id: string): Promise<void>;
}

export interface ProgressRepository {
  get(deckId: string): Promise<DeckProgress>;
  /** Merge a batch of reviews (newer cards win, day counters add up). */
  merge(deckId: string, batch: ProgressBatch): Promise<DeckProgress>;
}

// ---------- local (IndexedDB via Dexie) ----------

export class LocalDeckRepository implements DeckRepository {
  readonly kind = 'local';
  constructor(private readonly db: VocabDb) {}

  async list(): Promise<DeckSummary[]> {
    const decks = await this.db.decks.orderBy('updatedAt').reverse().toArray();
    return decks.map((d) => summarize(migrateDeck(d as unknown as Record<string, unknown>)));
  }

  async get(id: string): Promise<Deck> {
    const d = await this.db.decks.get(id);
    if (!d) throw new DeckError('Không tìm thấy bộ từ.', 404);
    return migrateDeck(d as unknown as Record<string, unknown>);
  }

  async create(deck: Deck): Promise<Deck> {
    if ((await this.db.decks.count()) >= LIMITS.maxDecksPerUser) throw new DeckError(`Tối đa ${LIMITS.maxDecksPerUser} bộ từ.`, 409);
    const now = new Date().toISOString();
    const stored = { ...deck, createdAt: deck.createdAt || now, updatedAt: now };
    delete stored._etag;
    await this.db.decks.put(stored);
    return stored;
  }

  async update(deck: Deck): Promise<Deck> {
    const stored = { ...deck, updatedAt: new Date().toISOString() };
    delete stored._etag;
    await this.db.decks.put(stored);
    return stored;
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.decks, this.db.progress, async () => {
      await this.db.decks.delete(id);
      await this.db.progress.delete(id);
    });
  }
}

export class LocalProgressRepository implements ProgressRepository {
  constructor(private readonly db: VocabDb) {}

  async get(deckId: string): Promise<DeckProgress> {
    return (await this.db.progress.get(deckId)) ?? emptyProgress(deckId);
  }

  async merge(deckId: string, batch: ProgressBatch): Promise<DeckProgress> {
    return this.db.transaction('rw', this.db.progress, async () => {
      const merged = mergeProgress(await this.get(deckId), batch);
      await this.db.progress.put(merged);
      return merged;
    });
  }
}

// ---------- cloud (/api, signed in) ----------

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new DeckError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0);
  }
  if (res.ok) return res;
  let data: { error?: string; current?: Record<string, unknown> } = {};
  try {
    if (res.headers.get('content-type')?.includes('json')) data = await res.json();
  } catch {
    // ignore
  }
  if (res.status === 412 && data.current) throw new ConflictError(migrateDeck(data.current));
  if (res.status === 401) throw new DeckError('Phiên đăng nhập đã hết, hãy đăng nhập lại.', 401);
  throw new DeckError(data.error ?? `Máy chủ gặp lỗi (HTTP ${res.status}).`, res.status);
}

const body = (deck: Deck) => {
  const { _etag, ...rest } = deck;
  void _etag;
  return JSON.stringify(rest);
};

export class CloudDeckRepository implements DeckRepository {
  readonly kind = 'cloud';

  async list(): Promise<DeckSummary[]> {
    return (await (await api('/api/decks')).json()) as DeckSummary[];
  }

  async get(id: string): Promise<Deck> {
    return migrateDeck(await (await api(`/api/decks/${encodeURIComponent(id)}`)).json());
  }

  async create(deck: Deck): Promise<Deck> {
    return migrateDeck(await (await api('/api/decks', { method: 'POST', body: body(deck) })).json());
  }

  async update(deck: Deck): Promise<Deck> {
    const res = await api(`/api/decks/${encodeURIComponent(deck.id)}`, {
      method: 'PUT',
      body: body(deck),
      headers: { 'If-Match': deck._etag ?? '' },
    });
    return migrateDeck(await res.json());
  }

  async remove(id: string): Promise<void> {
    await api(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

export class CloudProgressRepository implements ProgressRepository {
  async get(deckId: string): Promise<DeckProgress> {
    const p = (await (await api(`/api/progress/${encodeURIComponent(deckId)}`)).json()) as DeckProgress;
    return { ...emptyProgress(deckId), ...p, deckId };
  }

  async merge(deckId: string, batch: ProgressBatch): Promise<DeckProgress> {
    const p = (await (await api(`/api/progress/${encodeURIComponent(deckId)}`, { method: 'PUT', body: JSON.stringify(batch) })).json()) as DeckProgress;
    return { ...emptyProgress(deckId), ...p, deckId };
  }
}

/** Errors worth retrying later (offline, server busy); validation errors are not. */
export const isRetryable = (e: unknown) => e instanceof DeckError && (e.status === 0 || e.status === 429 || (e.status ?? 0) >= 500);

/** Fallback when IndexedDB is unavailable (some private modes): decks last until the tab closes. */
export class MemoryDeckRepository implements DeckRepository {
  readonly kind = 'local';
  private decks = new Map<string, Deck>();

  async list() {
    return [...this.decks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarize);
  }
  async get(id: string) {
    const d = this.decks.get(id);
    if (!d) throw new DeckError('Không tìm thấy bộ từ.', 404);
    return d;
  }
  async create(deck: Deck) {
    if (this.decks.size >= LIMITS.maxDecksPerUser) throw new DeckError(`Tối đa ${LIMITS.maxDecksPerUser} bộ từ.`, 409);
    const d = { ...deck, updatedAt: new Date().toISOString() };
    this.decks.set(d.id, d);
    return d;
  }
  async update(deck: Deck) {
    const d = { ...deck, updatedAt: new Date().toISOString() };
    this.decks.set(d.id, d);
    return d;
  }
  async remove(id: string) {
    this.decks.delete(id);
  }
}

export class MemoryProgressRepository implements ProgressRepository {
  private data = new Map<string, DeckProgress>();
  async get(deckId: string) {
    return this.data.get(deckId) ?? emptyProgress(deckId);
  }
  async merge(deckId: string, batch: ProgressBatch) {
    const merged = mergeProgress(await this.get(deckId), batch);
    this.data.set(deckId, merged);
    return merged;
  }
}
