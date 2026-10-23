import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ITEMS as ALL_WORDS, type BattleItem } from '../data/words';
import { mulberry32 } from '../game/rng';
import { GuestSession } from './guest';
import { HostSession, ONLINE_GRACE_MS, sanitizeForGuest } from './host';
import { createMemoryPair } from './memoryTransport';
import { isMessage } from './protocol';

const TEN_WORDS = ALL_WORDS.slice(0, 10);
const TEN = TEN_WORDS.map((w) => w.id);
const ids = (words: { id: string }[]) => words.map((w) => w.id);

function setup() {
  const pair = createMemoryPair();
  const host = new HostSession(pair.host, 'An', {
    match: { rng: mulberry32(5), roundTimeMs: 10_000, revealMs: 500 },
  });
  const guest = new GuestSession(pair.guest, 'Bình');
  pair.connect();
  return { pair, host, guest };
}

/** Both sides in the preview step with the default word set. */
function toPreview() {
  const s = setup();
  s.host.beginSelecting();
  expect(s.host.setWordSet(TEN_WORDS)).toBe(true);
  return s;
}

function toPlaying() {
  const s = toPreview();
  s.host.setReady(true);
  s.guest.setReady(true);
  vi.advanceTimersByTime(3000);
  return s;
}

describe('online host/guest', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exchanges names on connect', () => {
    const { host, guest } = setup();
    expect(host.snapshot.guestName).toBe('Bình');
    expect(guest.snapshot.hostName).toBe('An');
    expect(host.snapshot.status).toBe('connected');
  });

  describe('word set', () => {
    it('rejects fewer than 10 words', () => {
      const { host, guest } = setup();
      host.beginSelecting();
      expect(host.setWordSet(TEN_WORDS.slice(0, 9))).toBe(false);
      expect(host.setWordSet([...TEN_WORDS.slice(0, 9), TEN_WORDS[0]])).toBe(false); // duplicates count once
      expect(guest.snapshot.phase).toBe('selecting');
    });

    it('sends the chosen words to the guest', () => {
      const { host, guest } = toPreview();
      expect(host.snapshot.phase).toBe('preview');
      expect(guest.snapshot.phase).toBe('preview');
      expect(ids(guest.snapshot.words)).toEqual(TEN);
    });

    it('sends item content and question kinds, without the host deck ids', () => {
      const { host, guest } = setup();
      const mine: BattleItem = {
        id: 'i1',
        type: 'phrasal_verb',
        text: 'look into',
        meaning: 'điều tra',
        examples: [{ en: 'They looked into it.', vi: 'Họ đã điều tra.' }],
        tags: [],
        distractors: { wrongCollocations: [], wrongParticles: ['at', 'after'], wrongSentences: [] },
        deckId: 'host-deck',
      };
      host.beginSelecting();
      expect(host.setWordSet([mine, ...TEN_WORDS.slice(0, 9)], ['particle', 'meaning'])).toBe(true);
      const { deckId, ...expected } = mine;
      void deckId;
      expect(guest.snapshot.words[0]).toEqual(expected);
      expect(guest.snapshot.kinds).toEqual(['particle', 'meaning']);
      expect(host.snapshot.words[0].deckId).toBe('host-deck');
      host.setReady(true);
      guest.setReady(true);
      vi.advanceTimersByTime(3000);
      expect(guest.snapshot.phase).toBe('playing');
    });
  });

  describe('ready flow', () => {
    it('does not start when only one side is ready', () => {
      const { host, guest } = toPreview();
      host.setReady(true);
      expect(guest.snapshot.ready).toEqual({ host: true, guest: false });
      vi.advanceTimersByTime(10_000);
      expect(host.snapshot.phase).toBe('preview');
      expect(host.snapshot.game).toBeNull();

      host.setReady(false);
      guest.setReady(true);
      expect(host.snapshot.ready).toEqual({ host: false, guest: true });
      vi.advanceTimersByTime(10_000);
      expect(host.snapshot.phase).toBe('preview');
    });

    it('counts down 3-2-1 on both sides once both are ready, then starts', () => {
      const { host, guest } = toPreview();
      guest.setReady(true);
      host.setReady(true);
      expect(host.snapshot.phase).toBe('countdown');
      expect(guest.snapshot.phase).toBe('countdown');
      expect(guest.snapshot.countdown).toBe(3);
      vi.advanceTimersByTime(1000);
      expect(guest.snapshot.countdown).toBe(2);
      expect(host.snapshot.countdown).toBe(2);
      vi.advanceTimersByTime(2000);
      expect(host.snapshot.phase).toBe('playing');
      expect(guest.snapshot.phase).toBe('playing');
      expect(guest.snapshot.game!.round).toBe(1);
      expect(TEN).toContain(guest.snapshot.game!.question!.itemId);
    });

    it('going back to word selection resets readiness', () => {
      const { host, guest } = toPreview();
      guest.setReady(true);
      host.beginSelecting();
      expect(guest.snapshot.phase).toBe('selecting');
      expect(host.snapshot.ready).toEqual({ host: false, guest: false });
      host.setWordSet(TEN_WORDS);
      host.setReady(true);
      expect(host.snapshot.phase).toBe('preview'); // guest must ready again
    });

    it('ignores ready outside the preview step', () => {
      const { host, guest } = setup();
      guest.setReady(true);
      host.setReady(true);
      expect(host.snapshot.ready).toEqual({ host: false, guest: false });
    });
  });

  describe('match', () => {
    it('hides the correct answer from the guest while the question is open', () => {
      const { host, guest } = toPlaying();
      expect(host.snapshot.game!.question!.correctIndex).toBeGreaterThanOrEqual(0);
      expect(guest.snapshot.game!.question!.correctIndex).toBe(-1);
    });

    it('compares self-measured ms, not arrival order', () => {
      const { host, guest } = toPlaying();
      const q = host.snapshot.game!.question!;
      host.submitAnswer(q.id, q.correctIndex, 3000); // arrives first but slower
      guest.submitAnswer(q.id, q.correctIndex, 1200);
      const result = guest.snapshot.game!.lastResult!;
      expect(result.attacker).toBe('p2');
      expect(guest.snapshot.game!.players.p1.hp).toBeLessThan(100);
      expect(guest.snapshot.game!.players.p2.hp).toBe(100);
    });

    it('ignores stale and duplicate guest answers', () => {
      const { pair, host } = toPlaying();
      const q = host.snapshot.game!.question!;
      pair.guest.send({ type: 'answer', questionId: 'q0-old', answerIndex: q.correctIndex, ms: 1 });
      pair.guest.send({ type: 'answer', questionId: q.id, answerIndex: (q.correctIndex + 1) % 4, ms: 900 });
      pair.guest.send({ type: 'answer', questionId: q.id, answerIndex: q.correctIndex, ms: 100 });
      host.submitAnswer(q.id, q.correctIndex, 2000);
      expect(host.snapshot.game!.lastResult!.players.p2.correct).toBe(false);
      expect(host.snapshot.game!.lastResult!.attacker).toBe('p1');
    });

    it('waits for the guest up to round time + grace', () => {
      const { host } = toPlaying();
      const q = host.snapshot.game!.question!;
      host.submitAnswer(q.id, q.correctIndex, 500);
      vi.advanceTimersByTime(10_000);
      expect(host.snapshot.game!.phase).toBe('question');
      vi.advanceTimersByTime(ONLINE_GRACE_MS);
      expect(host.snapshot.game!.phase).toBe('reveal');
    });

    it('broadcasts game over and supports a rematch with the same words', () => {
      const { host, guest } = toPlaying();
      for (let i = 0; i < 30 && host.snapshot.phase !== 'over'; i++) {
        const q = host.snapshot.game!.question!;
        host.submitAnswer(q.id, q.correctIndex, 500);
        guest.submitAnswer(q.id, (q.correctIndex + 1) % 4, 500);
        vi.advanceTimersByTime(500);
      }
      expect(guest.snapshot.phase).toBe('over');
      expect(guest.snapshot.game!.winner).toBe('p1');
      expect(guest.snapshot.game!.players.p2.wrongItemIds.length).toBeGreaterThan(0);
      host.rematch();
      expect(guest.snapshot.phase).toBe('preview');
      expect(ids(guest.snapshot.words)).toEqual(TEN);
      expect(guest.snapshot.ready).toEqual({ host: false, guest: false });
    });
  });

  describe('leaving', () => {
    it('notifies the host when the guest leaves', () => {
      const { host, guest } = toPlaying();
      guest.leave();
      expect(host.snapshot.opponentLeft).toBe(true);
    });

    it('notifies the guest when the connection drops', () => {
      const { pair, guest } = toPreview();
      pair.guest.set('disconnected');
      expect(guest.snapshot.opponentLeft).toBe(true);
    });
  });
});

describe('protocol', () => {
  it('validates incoming messages', () => {
    expect(isMessage({ type: 'answer', questionId: 'q', answerIndex: 1, ms: 10 })).toBe(true);
    expect(isMessage({ type: 'answer', questionId: 'q', answerIndex: '1', ms: 10 })).toBe(false);
    const w = { id: 'x', type: 'idiom', text: 'break the ice', meaning: 'phá băng', examples: [{ en: 'a', vi: 'b' }], tags: [] };
    const ok = (items: unknown[], kinds: unknown = ['meaning']) => isMessage({ type: 'itemset', items, kinds });
    expect(ok([w])).toBe(true);
    expect(ok([{ ...w, level: 'B1', distractors: { wrongCollocations: [], wrongParticles: [], wrongSentences: ['x'] } }])).toBe(true);
    expect(ok([{ ...w, level: 'Z9' }])).toBe(false);
    expect(ok([{ ...w, type: 'verb' }])).toBe(false);
    expect(ok([{ ...w, meaning: 'x'.repeat(201) }])).toBe(false);
    expect(ok([{ ...w, examples: Array(6).fill({ en: 'a', vi: '' }) }])).toBe(false);
    expect(ok([{ ...w, distractors: { wrongCollocations: Array(7).fill('x'), wrongParticles: [], wrongSentences: [] } }])).toBe(false);
    expect(ok([{ ...w, deckId: 'someone-elses' }])).toBe(false);
    expect(ok(Array(301).fill(w))).toBe(false);
    expect(ok([w], [])).toBe(false);
    expect(ok([w], ['hack'])).toBe(false);
    expect(isMessage({ type: 'wordset', words: [] })).toBe(false);
    expect(isMessage({ type: 'nope' })).toBe(false);
    expect(isMessage(null)).toBe(false);
  });

  it('sanitizeForGuest leaves resolved rounds untouched', () => {
    const state = {
      players: {} as never,
      round: 1,
      phase: 'reveal' as const,
      question: { id: 'q', itemId: 'w', kind: 'meaning' as const, prompt: 'w', instruction: '', options: [], correctIndex: 2, explanation: 'x' },
      lastResult: null,
      winner: null,
    };
    expect(sanitizeForGuest(state)).toBe(state);
  });
});
