import type { VocabDb } from '../decks/db';
import { DeckError } from '../decks/repository';
import { VSTEP } from './config';
import { addCounts, emptyStats, errorCountsOf, summarizeWriting } from './stats';
import type { WritingRecord, WritingStats, WritingSummary } from './types';

export interface WritingHistory {
  summaries: WritingSummary[];
  stats: WritingStats;
}

/**
 * Graded essays: the API (Cosmos "writings") when signed in, IndexedDB otherwise. In the cloud the
 * server stores each attempt while grading it, so `add` is only used locally.
 */
export interface WritingRepository {
  readonly kind: 'cloud' | 'local';
  history(): Promise<WritingHistory>;
  get(id: string): Promise<WritingRecord>;
  /** Store a graded attempt (local only); sets its attempt number. */
  add(record: Omit<WritingRecord, 'attempt'>): Promise<WritingRecord>;
  remove(id: string): Promise<void>;
}

const newestFirst = (a: WritingSummary, b: WritingSummary) => b.createdAt.localeCompare(a.createdAt);

export class LocalWritingRepository implements WritingRepository {
  readonly kind = 'local';
  constructor(private readonly db: VocabDb) {}

  async history(): Promise<WritingHistory> {
    const records = await this.db.writings.orderBy('createdAt').reverse().limit(VSTEP.historyLimit).toArray();
    const stats = await this.db.writingStats.get('stats');
    return { summaries: records.map(summarizeWriting), stats: stats ? { writings: stats.writings, categories: stats.categories, rules: stats.rules } : emptyStats() };
  }

  async get(id: string): Promise<WritingRecord> {
    const r = await this.db.writings.get(id);
    if (!r) throw new DeckError('Không tìm thấy bài viết.', 404);
    return r;
  }

  async add(record: Omit<WritingRecord, 'attempt'>): Promise<WritingRecord> {
    return this.db.transaction('rw', this.db.writings, this.db.writingStats, async () => {
      const attempt = (await this.db.writings.where('promptId').equals(record.promptId).count()) + 1;
      const saved: WritingRecord = { ...record, attempt };
      await this.db.writings.put(saved);
      const stats = (await this.db.writingStats.get('stats')) ?? { id: 'stats', ...emptyStats() };
      await this.db.writingStats.put({ id: 'stats', ...addCounts(stats, errorCountsOf(saved.result.errors)) });
      return saved;
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.writings, this.db.writingStats, async () => {
      const r = await this.db.writings.get(id);
      if (!r) return;
      await this.db.writings.delete(id);
      const stats = await this.db.writingStats.get('stats');
      if (stats) await this.db.writingStats.put({ id: 'stats', ...addCounts(stats, errorCountsOf(r.result.errors), -1) });
    });
  }
}

/** When IndexedDB is unavailable: history lasts until the tab closes. */
export class MemoryWritingRepository implements WritingRepository {
  readonly kind = 'local';
  private records = new Map<string, WritingRecord>();
  private stats = emptyStats();

  async history() {
    return { summaries: [...this.records.values()].map(summarizeWriting).sort(newestFirst), stats: this.stats };
  }
  async get(id: string) {
    const r = this.records.get(id);
    if (!r) throw new DeckError('Không tìm thấy bài viết.', 404);
    return r;
  }
  async add(record: Omit<WritingRecord, 'attempt'>) {
    const attempt = [...this.records.values()].filter((r) => r.promptId === record.promptId).length + 1;
    const saved = { ...record, attempt };
    this.records.set(saved.id, saved);
    this.stats = addCounts(this.stats, errorCountsOf(saved.result.errors));
    return saved;
  }
  async remove(id: string) {
    const r = this.records.get(id);
    if (!r) return;
    this.records.delete(id);
    this.stats = addCounts(this.stats, errorCountsOf(r.result.errors), -1);
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new DeckError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0);
  }
  if (res.ok) return res;
  let msg: string | undefined;
  try {
    if (res.headers.get('content-type')?.includes('json')) msg = ((await res.json()) as { error?: string }).error;
  } catch {
    // ignore
  }
  if (res.status === 401) throw new DeckError('Phiên đăng nhập đã hết, hãy đăng nhập lại.', 401);
  throw new DeckError(msg ?? `Máy chủ gặp lỗi (HTTP ${res.status}).`, res.status);
}

export class CloudWritingRepository implements WritingRepository {
  readonly kind = 'cloud';

  async history(): Promise<WritingHistory> {
    const h = (await (await api('/api/writings')).json()) as Partial<WritingHistory>;
    return { summaries: (h.summaries ?? []).sort(newestFirst), stats: { ...emptyStats(), ...h.stats } };
  }

  async get(id: string): Promise<WritingRecord> {
    return (await (await api(`/api/writings/${encodeURIComponent(id)}`)).json()) as WritingRecord;
  }

  add(): Promise<WritingRecord> {
    return Promise.reject(new DeckError('Bài viết được lưu khi chấm trên máy chủ.', 400));
  }

  async remove(id: string): Promise<void> {
    await api(`/api/writings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
