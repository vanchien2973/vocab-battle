import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { Rating, emptyProgress, mergeProgress, newCard, type DeckProgress, type ProgressBatch } from '../study/fsrs';
import { MemoryPendingStore, ProgressQueue } from '../study/progressQueue';
import { VocabDb } from './db';
import { decodeDeckLink, deckLink, encodeDeckLink, exportCsv, importJson, isLinkTooLong, parseImport, splitCsvLine } from './importExport';
import { DeckError, LocalDeckRepository, LocalProgressRepository, type DeckRepository, type ProgressRepository } from './repository';
import { resolveNameClashes, syncLocalToCloud } from './sync';
import { emptyItem, newDeck, summarize, type Deck, type DeckSummary } from './types';

let dbSeq = 0;
const freshName = () => `test-db-${++dbSeq}`;

describe('Dexie upgrade v1 → v2', () => {
  it('migrates stored words[] decks to items[]', async () => {
    const name = freshName();
    const v1 = new Dexie(name);
    v1.version(1).stores({ decks: 'id, updatedAt', progress: 'deckId' });
    await v1.table('decks').put({
      id: 'd1',
      name: 'Cũ',
      description: '',
      level: 'A1',
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      words: [{ id: 'w1', word: 'apple', meaning: 'quả táo', example: 'I eat an apple.' }],
    });
    v1.close();

    const db = new VocabDb(name);
    const deck = await new LocalDeckRepository(db).get('d1');
    expect(deck.schemaVersion).toBe(2);
    expect(deck.items[0]).toMatchObject({ id: 'w1', type: 'word', text: 'apple', examples: [{ en: 'I eat an apple.', vi: '' }] });
    expect(await db.decks.get('d1')).not.toHaveProperty('words');
    db.close();
  });

  it('local repository enforces the deck limit and removes progress with the deck', async () => {
    const db = new VocabDb(freshName());
    const repo = new LocalDeckRepository(db);
    const progress = new LocalProgressRepository(db);
    const d = await repo.create(newDeck('A'));
    await progress.merge(d.id, { cards: { 'x|en-vi': newCard() }, days: {} });
    await repo.remove(d.id);
    expect((await progress.get(d.id)).cards).toEqual({});
    for (let i = 0; i < 50; i++) await repo.create(newDeck(`D${i}`));
    await expect(repo.create(newDeck('too many'))).rejects.toBeInstanceOf(DeckError);
    db.close();
  });
});

/** In-memory "cloud" for sync tests. */
class MemoryDecks implements DeckRepository {
  readonly kind = 'cloud';
  decks = new Map<string, Deck>();
  failOn?: string;
  async list(): Promise<DeckSummary[]> {
    return [...this.decks.values()].map(summarize);
  }
  async get(id: string) {
    return this.decks.get(id)!;
  }
  async create(d: Deck) {
    if (d.name === this.failOn) throw new DeckError('boom', 500);
    const saved = { ...d, id: `cloud-${d.id}` };
    this.decks.set(saved.id, saved);
    return saved;
  }
  async update(d: Deck) {
    this.decks.set(d.id, d);
    return d;
  }
  async remove(id: string) {
    this.decks.delete(id);
  }
}

class MemoryProgress implements ProgressRepository {
  data = new Map<string, DeckProgress>();
  fail = false;
  calls = 0;
  async get(id: string) {
    return this.data.get(id) ?? emptyProgress(id);
  }
  async merge(id: string, batch: ProgressBatch) {
    this.calls++;
    if (this.fail) throw new DeckError('offline', 0);
    const merged = mergeProgress(await this.get(id), batch);
    this.data.set(id, merged);
    return merged;
  }
}

describe('local → cloud sync', () => {
  it('suffixes clashing names and keeps both', () => {
    const out = resolveNameClashes([{ name: 'Travel' }, { name: 'travel' }, { name: 'Food' }], ['Travel', 'Travel (2)']);
    expect(out.map((d) => d.name)).toEqual(['Travel (3)', 'travel (4)', 'Food']);
  });

  it('copies decks with progress and removes them locally', async () => {
    const local = new MemoryDecks();
    const localProgress = new MemoryProgress();
    const cloud = new MemoryDecks();
    const cloudProgress = new MemoryProgress();
    const a = newDeck('Travel', { items: [emptyItem('word', { id: 'i1', text: 'trip', meaning: 'chuyến đi' })] });
    const b = newDeck('Broken');
    local.decks.set(a.id, a);
    local.decks.set(b.id, b);
    localProgress.data.set(a.id, mergeProgress(emptyProgress(a.id), { cards: { 'i1|en-vi': newCard() }, days: {} }));
    cloud.decks.set('c1', newDeck('Travel'));
    cloud.failOn = 'Broken';

    const r = await syncLocalToCloud(local, localProgress, cloud, cloudProgress);

    expect(r).toEqual({ copied: 1, renamed: 1, failed: ['Broken'] });
    expect([...cloud.decks.values()].map((d) => d.name).sort()).toEqual(['Travel', 'Travel (2)']);
    expect(cloudProgress.data.get(`cloud-${a.id}`)!.cards['i1|en-vi']).toBeDefined();
    expect([...local.decks.keys()]).toEqual([b.id]); // failed deck stays local
  });
});

describe('offline progress queue', () => {
  it('batches every 10 answers and keeps failed batches until back online', async () => {
    const repo = new MemoryProgress();
    const pending = new MemoryPendingStore();
    const q = new ProgressQueue(repo, pending, 'u1');

    repo.fail = true;
    for (let i = 0; i < 9; i++) await q.record('d1', `i${i}|en-vi`, newCard(), 'word', Rating.Good, true);
    expect(repo.calls).toBe(0);
    await q.record('d1', 'i9|en-vi', newCard(), 'idiom', Rating.Again, true); // 10th → flush, fails
    expect(repo.calls).toBe(1);
    expect(await pending.list('u1')).toHaveLength(1);

    repo.fail = false;
    await q.record('d2', 'x|cloze', newCard(), 'word', Rating.Good, false);
    await q.flush();
    expect(await pending.list('u1')).toHaveLength(0);
    const p = repo.data.get('d1')!;
    expect(Object.keys(p.cards)).toHaveLength(10);
    const today = Object.values(p.days)[0];
    expect(today).toMatchObject({ reviews: 10, again: 1, newCards: 10, byType: { word: [9, 9], idiom: [1, 0] } });
    expect(repo.data.get('d2')).toBeDefined();
  });

  it('drops batches the server rejects', async () => {
    const repo = new MemoryProgress();
    repo.merge = async () => {
      throw new DeckError('bad', 400);
    };
    const pending = new MemoryPendingStore();
    const q = new ProgressQueue(repo, pending, '');
    await q.record('d', 'a|en-vi', newCard(), 'word', Rating.Good, true);
    await q.flush();
    expect(await pending.list('')).toHaveLength(0);
  });
});

describe('import / export', () => {
  it('parses "word - nghĩa" lines with per-line errors', () => {
    const r = parseImport('apple - quả táo\n\nlook into – điều tra\nnope\nwell-known: nổi tiếng\nx -  ', 'lines');
    expect(r.map((l) => l.line)).toEqual([1, 3, 4, 5, 6]);
    expect(r[0].item).toMatchObject({ type: 'word', text: 'apple', meaning: 'quả táo' });
    expect(r[1].item).toMatchObject({ type: 'collocation', text: 'look into', meaning: 'điều tra' });
    expect(r[2].error).toBeTruthy();
    expect(r[3].item).toMatchObject({ text: 'well-known', meaning: 'nổi tiếng' });
    expect(r[4].error).toBeTruthy();
  });

  it('parses CSV with header, quotes and missing fields', () => {
    expect(splitCsvLine('"a, b","say ""hi""",c')).toEqual(['a, b', 'say "hi"', 'c']);
    const r = parseImport('word,meaning,example\nrun,chạy,"I run, fast."\nwalk,,x', 'csv');
    expect(r).toHaveLength(2);
    expect(r[0].item).toMatchObject({ text: 'run', meaning: 'chạy', examples: [{ en: 'I run, fast.', vi: '' }] });
    expect(r[1]).toEqual({ line: 3, error: 'Thiếu nghĩa.' });
  });

  it('round-trips CSV export and JSON import with a new id', () => {
    const deck = newDeck('T', { items: [emptyItem('idiom', { text: 'break the ice', meaning: 'phá băng, "làm quen"', examples: [{ en: 'Jokes break the ice.', vi: '' }] })] });
    const csv = exportCsv(deck);
    expect(csv.split('\n')[1]).toBe('break the ice,"phá băng, ""làm quen""",Jokes break the ice.,idiom,,,');
    const copy = importJson(JSON.stringify({ name: 'Old', words: [{ word: 'cat', meaning: 'mèo', example: '' }] }));
    expect(copy.items[0]).toMatchObject({ type: 'word', text: 'cat' });
    expect(() => importJson('[1]')).toThrow();
  });

  it('compresses and decompresses share links', () => {
    const deck = newDeck('Du lịch', {
      description: 'mô tả',
      level: 'B1',
      items: [emptyItem('phrasal_verb', { text: 'check in', meaning: 'nhận phòng', examples: [{ en: 'We checked in at 2pm.', vi: 'Chúng tôi nhận phòng lúc 2 giờ.' }] })],
    });
    const decoded = decodeDeckLink(encodeDeckLink(deck))!;
    expect(decoded.name).toBe('Du lịch');
    expect(decoded.level).toBe('B1');
    expect(decoded.id).not.toBe(deck.id);
    expect(decoded.items[0]).toMatchObject({ type: 'phrasal_verb', text: 'check in', examples: deck.items[0].examples });
    expect(decodeDeckLink('garbage!!')).toBeNull();
  });

  it('warns when a link is over 8000 characters', () => {
    const big = newDeck('Big', {
      items: Array.from({ length: 300 }, (_, i) => emptyItem('word', { text: `word${i}${Math.random()}`, meaning: `nghĩa ${Math.random()}`, examples: [{ en: `Example ${Math.random()}`, vi: '' }] })),
    });
    expect(isLinkTooLong(deckLink(big, 'https://x'))).toBe(true);
    expect(isLinkTooLong(deckLink(newDeck('Small'), 'https://x'))).toBe(false);
  });
});
