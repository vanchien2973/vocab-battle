import Ajv from 'ajv';
import deckSchema from '../../api/AiShared/deck.schema.json';
import distractorsSchema from '../../api/AiShared/distractors.schema.json';
import itemsSchema from '../../api/AiShared/items.schema.json';
import { ITEM_TYPES, LIMITS, type Distractors, type Item, type ItemType } from '../decks/types';
import { normalizeWord } from './normalize';
import { prompts } from './shared';
import { AiError, CEFR_LEVELS, type Cefr } from './types';

/** An item suggested by the AI, before it gets an id in a deck. */
export type GeneratedItem = Omit<Item, 'id'>;

export interface GeneratedDeck {
  name: string;
  description: string;
  level: Cefr;
  items: GeneratedItem[];
}

export interface GenerateDeckInput {
  topic: string;
  level: Cefr;
  count: number;
}

export interface DistractorInput {
  type: ItemType;
  text: string;
  meaning: string;
}

export type DistractorResult = Distractors & { text: string };

export const MAX_SUGGESTIONS = 10;
export const MAX_EXTRACTED = 30;
export const MAX_DISTRACTOR_ITEMS = 10;
// Same defaults as the server (AI_GENERATE_MAX_TOKENS, AI_LOOKUP_MAX_TOKENS).
const GENERATE_MAX_TOKENS = 4000;
const LOOKUP_MAX_TOKENS = 1500;

/** A structured-output request built from the shared, fixed prompts (api/AiShared/prompts.json). */
export interface StructuredRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  maxTokens: number;
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');
const clip = (s: unknown, max: number) => clean(s).slice(0, max).trim();
const PHRASE_TYPES: readonly ItemType[] = ['collocation', 'phrasal_verb', 'idiom', 'pattern'];

function requireLevel(level: string): Cefr {
  if (!CEFR_LEVELS.includes(level as Cefr)) throw new AiError('Level phải là A1–C2.', 400);
  return level as Cefr;
}

// ---------- input checks (mirror AiTasksService on the server) ----------

export function checkGenerateDeck(input: GenerateDeckInput): GenerateDeckInput {
  const g = LIMITS.generateDeck;
  const topic = clean(input.topic);
  if (!topic || topic.length > g.maxTopicLength) throw new AiError(`Chủ đề cần từ 1 đến ${g.maxTopicLength} ký tự.`, 400);
  if (!Number.isInteger(input.count) || input.count < g.minCount || input.count > g.maxCount)
    throw new AiError(`Số mục phải từ ${g.minCount} đến ${g.maxCount}.`, 400);
  return { topic, level: requireLevel(input.level), count: input.count };
}

export function checkPassage(passage: string): string {
  const p = passage.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
  const max = LIMITS.extractItems.maxPassageLength;
  if (!p || p.length > max) throw new AiError(`Đoạn văn cần từ 1 đến ${max} ký tự.`, 400);
  return p;
}

export function checkDistractorItems(items: readonly DistractorInput[]): DistractorInput[] {
  if (items.length === 0 || items.length > MAX_DISTRACTOR_ITEMS) throw new AiError(`Cần từ 1 đến ${MAX_DISTRACTOR_ITEMS} mục.`, 400);
  return items.map((it) => {
    const text = clean(it.text);
    if (!ITEM_TYPES.includes(it.type) || !text || text.length > LIMITS.fieldLength.text) throw new AiError('Từ/cụm từ không hợp lệ.', 400);
    return { type: it.type, text, meaning: clip(it.meaning, LIMITS.fieldLength.meaning) };
  });
}

// ---------- requests (for the direct BYOK client; the server builds the same ones) ----------

export function generateDeckRequest(input: GenerateDeckInput): StructuredRequest {
  const { topic, level, count } = checkGenerateDeck(input);
  const p = prompts.tasks.generateDeck;
  return {
    system: p.system,
    user: p.user.replace('{topic}', topic).replace('{level}', level).replace('{count}', String(count)),
    schemaName: 'deck',
    schema: deckSchema,
    maxTokens: GENERATE_MAX_TOKENS,
  };
}

export function suggestPhrasesRequest(word: string): StructuredRequest {
  const w = normalizeWord(word);
  if (!w) throw new AiError('Từ phải là chữ cái tiếng Anh, tối đa 40 ký tự.', 400);
  const p = prompts.tasks.suggestPhrases;
  return { system: p.system, user: p.user.replace('{word}', w), schemaName: 'items', schema: itemsSchema, maxTokens: LOOKUP_MAX_TOKENS * 2 };
}

export function extractItemsRequest(passage: string, level: Cefr): StructuredRequest {
  const p = prompts.tasks.extractItems;
  const text = checkPassage(passage).replace(/"""/g, '"');
  return {
    system: p.system,
    user: p.user.replace('{level}', requireLevel(level)).replace('{passage}', text),
    schemaName: 'items',
    schema: itemsSchema,
    maxTokens: GENERATE_MAX_TOKENS,
  };
}

export function distractorsRequest(items: readonly DistractorInput[]): StructuredRequest {
  const p = prompts.tasks.distractors;
  return {
    system: p.system,
    user: p.user.replace('{items}', JSON.stringify(checkDistractorItems(items))),
    schemaName: 'distractors',
    schema: distractorsSchema,
    maxTokens: LOOKUP_MAX_TOKENS,
  };
}

// ---------- output validation and cleanup ----------

let ajv: Ajv | null = null;
const validators = new Map<string, ReturnType<Ajv['compile']>>();

/** Parse and validate model output against the schema; null when it does not match. */
export function parseStructured<T>(schemaName: string, schema: object, text: string): T | null {
  ajv ??= new Ajv({ allErrors: false });
  let validate = validators.get(schemaName);
  if (!validate) validators.set(schemaName, (validate = ajv.compile(schema)));
  try {
    const data: unknown = JSON.parse(text);
    return validate(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

/** Known types, clipped fields, ≤ 5 examples, no duplicates (same as AiTasksService.CleanItems). */
export function cleanItems(raw: unknown, max: number, typeFilter?: (t: ItemType) => boolean): GeneratedItem[] {
  const f = LIMITS.fieldLength;
  const seen = new Set<string>();
  const out: GeneratedItem[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length === max || !x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const type = r.type as ItemType;
    if (!ITEM_TYPES.includes(type) || (typeFilter && !typeFilter(type))) continue;
    const text = clip(r.text, f.text);
    const meaning = clip(r.meaning, f.meaning);
    const key = `${type}|${text.toLowerCase()}`;
    if (!text || !meaning || seen.has(key)) continue;
    seen.add(key);
    const examples = (Array.isArray(r.examples) ? r.examples : [])
      .map((e: Record<string, unknown>) => ({ en: clip(e?.en, f.example), vi: clip(e?.vi, f.example) }))
      .filter((e) => e.en)
      .slice(0, LIMITS.maxExamplesPerItem);
    const item: GeneratedItem = { type, text, meaning, examples, tags: [] };
    const pos = clip(r.partOfSpeech, f.partOfSpeech);
    const ipa = clip(r.ipa, f.ipa);
    const note = clip(r.note, f.note);
    if (pos) item.partOfSpeech = pos;
    if (ipa) item.ipa = ipa;
    if (note) item.note = note;
    out.push(item);
  }
  return out;
}

export const onlyPhrases = (t: ItemType) => PHRASE_TYPES.includes(t);

function cleanList(raw: unknown, maxLength: number, exclude?: string): string[] {
  const seen = new Set<string>(exclude ? [exclude.toLowerCase()] : []);
  const out: string[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const s = clip(x, maxLength);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length === LIMITS.maxDistractorsPerList) break;
  }
  return out;
}

/** Distractors in input order (matched by text, else by position); particles only for phrasal verbs. */
export function cleanDistractors(raw: unknown, inputs: readonly DistractorInput[]): DistractorResult[] {
  const results = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return inputs.map((input, i) => {
    const r = results.find((x) => typeof x?.text === 'string' && x.text.toLowerCase() === input.text.toLowerCase()) ?? results[i];
    const particle = input.text.trim().split(/\s+/)[1];
    return {
      text: input.text,
      wrongCollocations: cleanList(r?.wrongCollocations, LIMITS.fieldLength.text, input.text),
      wrongParticles: input.type === 'phrasal_verb' ? cleanList(r?.wrongParticles, 20, particle) : [],
      wrongSentences: cleanList(r?.wrongSentences, LIMITS.fieldLength.example),
    };
  });
}

export function cleanDeck(raw: Record<string, unknown>, input: GenerateDeckInput): GeneratedDeck {
  return {
    name: clip(raw.name, LIMITS.fieldLength.deckName) || clip(input.topic, LIMITS.fieldLength.deckName),
    description: clip(raw.description, LIMITS.fieldLength.deckDescription),
    level: input.level,
    items: cleanItems(raw.items, input.count),
  };
}
