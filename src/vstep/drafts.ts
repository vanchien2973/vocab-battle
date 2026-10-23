import type { VocabDb } from '../decks/db';
import type { TargetLevel, WritingMode } from './config';
import type { WritingPrompt } from './types';

/** The essay being written: one per device, restored after a closed tab. */
export interface WritingDraft {
  id: 'current';
  mode: WritingMode;
  level: TargetLevel;
  prompts: WritingPrompt[];
  /** One text per prompt. */
  texts: string[];
  /** Index of the task on screen (exam mode switches between two). */
  active: number;
  startedAt: number;
  /** Wall-clock deadline (ms): the clock keeps running while the tab is closed. */
  deadline: number;
  spellcheck: boolean;
  /** Set when rewriting an earlier attempt. */
  rewriteOf?: string;
  savedAt: number;
}

export interface DraftStore {
  load(): Promise<WritingDraft | null>;
  save(draft: WritingDraft): Promise<void>;
  clear(): Promise<void>;
}

export class DexieDraftStore implements DraftStore {
  constructor(private readonly db: VocabDb) {}
  async load() {
    return (await this.db.writingDrafts.get('current')) ?? null;
  }
  async save(draft: WritingDraft) {
    await this.db.writingDrafts.put(draft);
  }
  async clear() {
    await this.db.writingDrafts.delete('current');
  }
}

export class MemoryDraftStore implements DraftStore {
  private draft: WritingDraft | null = null;
  async load() {
    return this.draft ? structuredClone(this.draft) : null;
  }
  async save(draft: WritingDraft) {
    this.draft = structuredClone(draft);
  }
  async clear() {
    this.draft = null;
  }
}

/** A draft worth offering to restore: something was written. */
export const hasContent = (d: WritingDraft | null): d is WritingDraft => !!d && d.texts.some((t) => t.trim().length > 0);

/**
 * Saves the draft every few seconds, only when it changed. `flush` saves right away (on submit, on
 * leaving the page). Errors are ignored: a failed save is retried on the next tick.
 */
export class DraftAutosaver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = '';

  constructor(
    private readonly store: DraftStore,
    private readonly current: () => WritingDraft,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  start(): this {
    this.stop();
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush(): Promise<boolean> {
    const d = this.current();
    const { savedAt: _, ...rest } = d;
    void _;
    const key = JSON.stringify(rest);
    if (key === this.last) return false;
    // Marked before the write finishes so a slow save is not repeated by the next tick.
    this.last = key;
    try {
      await this.store.save({ ...d, savedAt: this.now() });
      return true;
    } catch {
      if (this.last === key) this.last = '';
      return false;
    }
  }
}
