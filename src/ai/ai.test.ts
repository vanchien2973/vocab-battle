import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFromEntry } from '../decks/itemTools';
import { MAX_MESSAGES, MAX_TOTAL_CHARS, contextNote, prepareChat, trimHistory } from './chatHistory';
import { MAX_CACHED, cacheLookup, getCachedLookup } from './lookupCache';
import { normalizeWord, parseLookup, prompts } from './shared';
import type { ChatMsg, LookupEntry } from './types';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const entry = (word: string, overrides: Partial<LookupEntry> = {}): LookupEntry => ({
  word,
  itemType: 'word',
  ipa: '/x/',
  cefr: 'C1',
  senses: [
    { partOfSpeech: 'adjective', meaningVi: 'kiên cường', definitionEn: 'able to recover' },
    { partOfSpeech: 'adjective', meaningVi: 'đàn hồi', definitionEn: 'springing back' },
    { partOfSpeech: 'adjective', meaningVi: 'kiên cường', definitionEn: 'dup' },
  ],
  examples: [{ en: 'She is resilient.', vi: 'Cô ấy kiên cường.' }],
  collocations: [],
  synonyms: [],
  antonyms: [],
  commonMistakes: [],
  ...overrides,
});

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('chat history trimming', () => {
  const turns = (n: number): ChatMsg[] =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));

  it('keeps at most the last 20 messages and starts with a user turn', () => {
    const t = trimHistory(turns(25));
    expect(t.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(t[0].role).toBe('user');
    expect(t[t.length - 1].content).toBe('m24');
  });

  it('drops empty messages, caps length and fits the total budget', () => {
    const long: ChatMsg[] = Array.from({ length: 19 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(5000),
    }));
    const t = trimHistory([{ role: 'user', content: '   ' }, ...long]);
    expect(t.every((m) => m.content.length <= 1500)).toBe(true);
    expect(t.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
    expect(t[0].role).toBe('user');
  });

  it('builds the same system prompt and context note as the server', () => {
    const { system, messages } = prepareChat({
      mode: 'practice',
      level: 'B1',
      words: [{ word: 'resilient', meaning: 'kiên cường' }],
      messages: [{ role: 'user', content: 'Quiz me' }],
    });
    expect(system).toBe(`${prompts.chatBase}\n\n${prompts.chatModes.practice}`);
    expect(messages[0].content).toBe('[Context note] Learner level: B1. Word list: resilient (kiên cường).\n\nQuiz me');
    expect(contextNote(undefined, [])).toBeNull();
  });
});

describe('lookup cache', () => {
  it('returns cached entries by normalized word', () => {
    expect(getCachedLookup('resilient')).toBeNull();
    cacheLookup('Resilient ', entry('resilient'));
    expect(getCachedLookup('  RESILIENT')?.word).toBe('resilient');
  });

  it('evicts the oldest entries beyond the limit', () => {
    for (let i = 0; i <= MAX_CACHED; i++) cacheLookup(`word${String.fromCharCode(97 + (i % 26))}${'z'.repeat(Math.floor(i / 26))}`, entry('w'), i);
    expect(getCachedLookup('worda')).toBeNull(); // the very first one (at = 0)
    expect(getCachedLookup('wordb')).not.toBeNull();
  });

  it('survives a throwing localStorage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => cacheLookup('resilient', entry('resilient'))).not.toThrow();
    expect(getCachedLookup('resilient')).toBeNull();
  });
});

describe('dictionary entry → deck item', () => {
  it('keeps the type the lookup detected, two meanings and examples', () => {
    const it = itemFromEntry(entry('look into', { itemType: 'phrasal_verb' }), 'root');
    expect(it).toMatchObject({ type: 'phrasal_verb', text: 'look into', meaning: 'kiên cường; đàn hồi', relatedTo: 'root' });
    expect(it.ipa).toBeUndefined();
    expect(itemFromEntry(entry('resilient')).ipa).toBe('/x/');
  });
});

describe('shared schema', () => {
  it('validates lookup output with the server schema', () => {
    expect(parseLookup(JSON.stringify(entry('resilient')))?.word).toBe('resilient');
    expect(parseLookup(JSON.stringify({ ...entry('x'), cefr: 'D1' }))).toBeNull();
    expect(parseLookup('{"word":')).toBeNull();
  });

  it('normalizes words like the server', () => {
    expect(normalizeWord('  Give  Up ')).toBe('give up');
    expect(normalizeWord('<b>')).toBeNull();
    expect(normalizeWord('a'.repeat(41))).toBeNull();
  });
});

describe('phrases in AI context', () => {
  it('tags phrase types in the context note like the server', async () => {
    const { contextNote } = await import('./chatHistory');
    expect(
      contextNote('B1', [
        { word: 'look into', meaning: 'điều tra', type: 'phrasal_verb' },
        { word: 'run', meaning: 'chạy', type: 'word' },
      ]),
    ).toBe('[Context note] Learner level: B1. Word list: look into [phrasal verb] (điều tra); run (chạy).');
  });
});
