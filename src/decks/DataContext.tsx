import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchMe, type AuthUser } from '../auth/auth';
import { readJSON, writeJSON } from '../storage/safeStorage';
import { emptyProgress, type DeckProgress } from '../study/fsrs';
import { MemoryPendingStore, ProgressQueue, type PendingStore } from '../study/progressQueue';
import { DexieDraftStore, MemoryDraftStore, type DraftStore } from '../vstep/drafts';
import { CloudWritingRepository, LocalWritingRepository, MemoryWritingRepository, type WritingRepository } from '../vstep/repository';
import { DexiePendingStore, getDb } from './db';
import { takeLegacyMyWords } from './migrate';
import {
  CloudDeckRepository,
  CloudProgressRepository,
  DeckError,
  LocalDeckRepository,
  LocalProgressRepository,
  MemoryDeckRepository,
  MemoryProgressRepository,
  type DeckRepository,
  type ProgressRepository,
} from './repository';
import { resolveNameClashes, syncLocalToCloud, type SyncResult } from './sync';
import { newDeck, type Deck, type DeckSummary } from './types';

interface Repos {
  decks: DeckRepository;
  progress: ProgressRepository;
  writings: WritingRepository;
}

interface DataApi {
  user: AuthUser | null;
  authLoading: boolean;
  /** "cloud" when signed in, else "local" (IndexedDB) or "memory" when IndexedDB is unavailable. */
  storage: 'cloud' | 'local' | 'memory';
  summaries: DeckSummary[] | null;
  listError: string | null;
  refresh: () => Promise<void>;
  loadDeck: (id: string) => Promise<Deck>;
  /** All decks with items (cached by updatedAt). */
  loadAllDecks: () => Promise<Deck[]>;
  createDeck: (deck: Deck) => Promise<Deck>;
  saveDeck: (deck: Deck) => Promise<Deck>;
  removeDeck: (id: string) => Promise<void>;
  /** Save a deck someone shared, renaming it on a name clash. */
  importDeck: (deck: Deck) => Promise<Deck>;
  loadProgress: (deckId: string) => Promise<DeckProgress>;
  queue: ProgressQueue;
  /** VSTEP writing history (cloud when signed in) and this device's draft. */
  writings: WritingRepository;
  drafts: DraftStore;
  /** Local decks to offer syncing after the first sign-in (null when nothing to ask); cleared by declineSync. */
  syncOffer: number | null;
  acceptSync: () => Promise<SyncResult>;
  declineSync: () => void;
}

const Ctx = createContext<DataApi | null>(null);
const SYNC_ASKED_KEY = 'vocab-battle.syncAsked.v1';

function localRepos(): Repos & { pending: PendingStore; drafts: DraftStore; kind: 'local' | 'memory' } {
  const db = getDb();
  if (db) {
    return {
      decks: new LocalDeckRepository(db),
      progress: new LocalProgressRepository(db),
      writings: new LocalWritingRepository(db),
      pending: new DexiePendingStore(db),
      drafts: new DexieDraftStore(db),
      kind: 'local',
    };
  }
  return {
    decks: new MemoryDeckRepository(),
    progress: new MemoryProgressRepository(),
    writings: new MemoryWritingRepository(),
    pending: new MemoryPendingStore(),
    drafts: new MemoryDraftStore(),
    kind: 'memory',
  };
}

let legacyOnce: Promise<void> | null = null;

/** Moves the old localStorage "Của tôi" words into a local deck once (StrictMode runs effects twice). */
function migrateLegacy(local: DeckRepository): Promise<void> {
  legacyOnce ??= migrateLegacyNow(local);
  return legacyOnce;
}

async function migrateLegacyNow(local: DeckRepository) {
  const { deck, clear } = takeLegacyMyWords();
  if (!deck) return;
  try {
    const names = (await local.list()).map((d) => d.name);
    await local.create(resolveNameClashes([deck], names)[0]);
    clear();
  } catch {
    // keep the old list; try again next time
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [summaries, setSummaries] = useState<DeckSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [syncOffer, setSyncOffer] = useState<number | null>(null);
  /** False when signed in but the server has no database configured (API answers 503). */
  const [cloudReady, setCloudReady] = useState(false);
  const local = useMemo(localRepos, []);
  const cache = useRef(new Map<string, Deck>());

  const repos: Repos = useMemo(
    () => (user && cloudReady ? { decks: new CloudDeckRepository(), progress: new CloudProgressRepository(), writings: new CloudWritingRepository() } : local),
    [user, cloudReady, local],
  );
  const cloud = user && cloudReady;
  const queue = useMemo(() => new ProgressQueue(repos.progress, local.pending, cloud ? user.userId : ''), [repos, local, user, cloud]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await migrateLegacy(local.decks);
      const me = await fetchMe();
      // Signed in but no database on the server yet (503): keep using this device's storage.
      const ready = me ? await cloudAvailable() : false;
      if (!alive) return;
      setUser(me);
      setCloudReady(ready);
      setAuthLoading(false);
      if (me && ready) {
        const asked = readJSON<string[]>(SYNC_ASKED_KEY, []);
        const n = (await local.decks.list()).length;
        if (n > 0 && !asked.includes(me.userId)) setSyncOffer(n);
      }
    })();
    return () => {
      alive = false;
    };
  }, [local]);

  const refresh = useCallback(async () => {
    try {
      setSummaries(await repos.decks.list());
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
      setSummaries((s) => s ?? []);
    }
  }, [repos]);

  useEffect(() => {
    cache.current.clear();
    setSummaries(null);
    if (!authLoading) void refresh();
  }, [repos, authLoading, refresh]);

  // Send queued progress when coming back online or leaving the page.
  useEffect(() => {
    const flush = () => void queue.flush();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onHide);
    flush();
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [queue]);

  const remember = (d: Deck) => {
    cache.current.set(d.id, d);
    return d;
  };

  const loadDeck = useCallback(
    async (id: string) => {
      const cached = cache.current.get(id);
      const summary = summaries?.find((s) => s.id === id);
      if (cached && summary && summary.updatedAt === cached.updatedAt) return cached;
      return remember(await repos.decks.get(id));
    },
    [repos, summaries],
  );

  const loadAllDecks = useCallback(async () => {
    const list = summaries ?? (await repos.decks.list());
    return Promise.all(list.map((s) => loadDeck(s.id)));
  }, [summaries, repos, loadDeck]);

  const api: DataApi = {
    user,
    authLoading,
    storage: cloud ? 'cloud' : local.kind,
    summaries,
    listError,
    refresh,
    loadDeck,
    loadAllDecks,
    createDeck: async (deck) => {
      const saved = remember(await repos.decks.create(deck));
      await refresh();
      return saved;
    },
    saveDeck: async (deck) => {
      const saved = remember(await repos.decks.update(deck));
      setSummaries((list) => list?.map((s) => (s.id === saved.id ? { ...s, name: saved.name, description: saved.description, level: saved.level, itemCount: saved.items.length, updatedAt: saved.updatedAt } : s)) ?? list);
      return saved;
    },
    removeDeck: async (id) => {
      await repos.decks.remove(id);
      cache.current.delete(id);
      await refresh();
    },
    importDeck: async (deck) => {
      const names = (summaries ?? (await repos.decks.list())).map((s) => s.name);
      const [renamed] = resolveNameClashes([newDeck(deck.name, { description: deck.description, level: deck.level, items: deck.items })], names);
      const saved = remember(await repos.decks.create(renamed));
      await refresh();
      return saved;
    },
    loadProgress: async (deckId) => {
      try {
        return await repos.progress.get(deckId);
      } catch {
        return emptyProgress(deckId);
      }
    },
    queue,
    writings: repos.writings,
    drafts: local.drafts,
    syncOffer,
    acceptSync: async () => {
      const result = await syncLocalToCloud(local.decks, local.progress, repos.decks, repos.progress);
      markAsked(user);
      await refresh();
      return result;
    },
    declineSync: () => {
      markAsked(user);
      setSyncOffer(null);
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

async function cloudAvailable(): Promise<boolean> {
  try {
    await new CloudDeckRepository().list();
    return true;
  } catch (e) {
    return !(e instanceof DeckError && (e.status === 503 || e.status === 404));
  }
}

function markAsked(user: AuthUser | null) {
  if (!user) return;
  writeJSON(SYNC_ASKED_KEY, [...new Set([...readJSON<string[]>(SYNC_ASKED_KEY, []), user.userId])]);
}

export function useData(): DataApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
