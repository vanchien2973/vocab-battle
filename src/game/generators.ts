import type { BattleItem } from '../data/words';
import { ITEM_TYPE_LABELS } from '../decks/types';
import { BLANK, findInSentence, makeCloze } from '../study/cloze';
import { shuffle, type Rng } from './rng';
import type { Question, QuestionKind } from './types';

export const OPTION_COUNT = 4;

export interface GenContext {
  /** Items wrong options may come from (selected items plus the built-in words). */
  pool: readonly BattleItem[];
  rng: Rng;
  seq: number;
}

/**
 * One kind of battle question. Pure: the same item, pool and rng always give the same question.
 * `canGenerate` says whether the item has the data the kind needs; `generate` may still return null.
 */
export interface QuestionGenerator {
  kind: QuestionKind;
  label: string;
  canGenerate(item: BattleItem, pool: readonly BattleItem[]): boolean;
  generate(item: BattleItem, ctx: GenContext): Question | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * Up to `n` distinct wrong values from the pool, preferring items of the same type (so a phrasal
 * verb is not paired with obviously different single words), never equal to any of `exclude`.
 */
export function pickDistractors(
  item: BattleItem,
  pool: readonly BattleItem[],
  rng: Rng,
  n: number,
  valueOf: (it: BattleItem) => string | null,
  exclude: readonly string[] = [],
): string[] {
  const seen = new Set(exclude.map(norm));
  const out: string[] = [];
  const others = shuffle(
    pool.filter((p) => p.id !== item.id),
    rng,
  );
  const sameType = others.filter((p) => p.type === item.type);
  const rest = others.filter((p) => p.type !== item.type);
  for (const p of [...sameType, ...rest]) {
    if (out.length === n) break;
    const v = valueOf(p);
    if (!v || seen.has(norm(v))) continue;
    seen.add(norm(v));
    out.push(v);
  }
  return out;
}

/** Shuffle the correct answer in with the wrong ones; null when there are not enough wrong options. */
function build(
  kind: QuestionKind,
  item: BattleItem,
  ctx: GenContext,
  fields: { prompt: string; instruction: string; correct: string; wrong: string[]; explanation: string; correctIsWrongAnswer?: boolean },
): Question | null {
  if (fields.wrong.length < OPTION_COUNT - 1) return null;
  const options = shuffle([fields.correct, ...fields.wrong.slice(0, OPTION_COUNT - 1)], ctx.rng);
  return {
    id: `q${ctx.seq}-${item.id}`,
    itemId: item.id,
    kind,
    prompt: fields.prompt,
    instruction: fields.instruction,
    options,
    correctIndex: options.indexOf(fields.correct),
    explanation: fields.explanation,
  };
}

const exampleOf = (item: BattleItem) => (item.examples[0] ? ` · “${item.examples[0].en}”` : '');

// ---------- Nghĩa ----------

export const meaningGenerator: QuestionGenerator = {
  kind: 'meaning',
  label: 'Nghĩa',
  canGenerate: (item) => item.meaning.trim() !== '',
  generate: (item, ctx) =>
    build('meaning', item, ctx, {
      prompt: item.text,
      instruction: item.type === 'word' ? 'Chọn nghĩa đúng' : `${ITEM_TYPE_LABELS[item.type]} · chọn nghĩa đúng`,
      correct: item.meaning,
      wrong: pickDistractors(item, ctx.pool, ctx.rng, OPTION_COUNT - 1, (p) => p.meaning, [item.meaning]),
      explanation: `${item.text} = ${item.meaning}${exampleOf(item)}`,
    }),
};

// ---------- Cloze ----------

export const clozeGenerator: QuestionGenerator = {
  kind: 'cloze',
  label: 'Điền chỗ trống',
  canGenerate: (item) => makeCloze(item) !== null,
  generate: (item, ctx) => {
    const cloze = makeCloze(item);
    if (!cloze) return null;
    // Options in the same form as the answer: other items' text (same type first).
    return build('cloze', item, ctx, {
      prompt: cloze.sentence,
      instruction: 'Chọn từ/cụm từ điền vào chỗ trống',
      correct: cloze.answer,
      wrong: pickDistractors(item, ctx.pool, ctx.rng, OPTION_COUNT - 1, (p) => p.text, [cloze.answer, item.text]),
      explanation: `${cloze.example.en} — ${item.text} = ${item.meaning}`,
    });
  },
};

// ---------- Ghép cặp collocation ----------

/**
 * Which words of a collocation the quiz asks for, found from the AI's wrong versions: the positions
 * they most often change. "make a decision" vs "do a decision", "take a decision" → blank the verb:
 * "___ a decision", options make / do / take…; "heavy rain" vs "strong rain" → "___ rain".
 */
export function collocationParts(item: Pick<BattleItem, 'type' | 'text' | 'distractors'>) {
  if (item.type !== 'collocation') return null;
  const c = words(item.text);
  if (c.length < 2) return null;
  const byDiff = new Map<string, string[][]>();
  for (const wrong of item.distractors?.wrongCollocations ?? []) {
    const w = words(wrong);
    if (w.length !== c.length) continue;
    const diff = c.map((_, i) => i).filter((i) => norm(w[i]) !== norm(c[i]));
    if (diff.length === 0 || diff.length === c.length) continue;
    const key = diff.join(',');
    byDiff.set(key, [...(byDiff.get(key) ?? []), w]);
  }
  const best = [...byDiff].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return null;
  const blank = best[0].split(',').map(Number);
  const pick = (tokens: string[]) => blank.map((i) => tokens[i]).join(' ');
  const correct = pick(c);
  const seen = new Set([norm(correct)]);
  const wrong: string[] = [];
  for (const w of best[1]) {
    const v = pick(w);
    if (!seen.has(norm(v))) {
      seen.add(norm(v));
      wrong.push(v);
    }
  }
  const given = c.filter((_, i) => !blank.includes(i)).join(' ');
  const prompt = c.map((t, i) => (!blank.includes(i) ? t : i === blank[0] ? BLANK : null)).filter((t) => t !== null).join(' ');
  return { correct, wrong, given, prompt };
}

export const collocationGenerator: QuestionGenerator = {
  kind: 'collocation',
  label: 'Ghép collocation',
  // Wrong partners come only from the AI distractors: another item's word could form a valid collocation too.
  canGenerate: (item) => (collocationParts(item)?.wrong.length ?? 0) >= OPTION_COUNT - 1,
  generate: (item, ctx) => {
    const parts = collocationParts(item);
    if (!parts) return null;
    return build('collocation', item, ctx, {
      prompt: parts.prompt,
      instruction: `Từ nào đi với “${parts.given}”?`,
      correct: parts.correct,
      wrong: shuffle(parts.wrong, ctx.rng),
      explanation: `✓ ${item.text} (${item.meaning}) · ✗ ${item.distractors?.wrongCollocations.slice(0, 2).join(', ')}`,
    });
  },
};

// ---------- Giới từ / tiểu từ phrasal verb ----------

export const COMMON_PARTICLES = ['up', 'out', 'in', 'on', 'off', 'at', 'into', 'after', 'over', 'down', 'away', 'back', 'for', 'about', 'through', 'with'];

export const particleGenerator: QuestionGenerator = {
  kind: 'particle',
  label: 'Tiểu từ phrasal verb',
  canGenerate: (item) => item.type === 'phrasal_verb' && words(item.text).length >= 2,
  generate: (item, ctx) => {
    const tokens = words(item.text);
    if (item.type !== 'phrasal_verb' || tokens.length < 2) return null;
    const particle = tokens.slice(1).join(' ');
    // Prefer the example sentence: "The police looked ___ the case."
    let prompt = `${tokens[0]} ${BLANK}`;
    for (const ex of item.examples) {
      const pos = findInSentence(ex.en, item.text);
      if (!pos) continue;
      const span = ex.en.slice(pos.start, pos.end);
      const verb = words(span)[0];
      prompt = ex.en.slice(0, pos.start) + `${verb} ${BLANK}` + ex.en.slice(pos.end);
      break;
    }
    const wrong = [...(item.distractors?.wrongParticles ?? [])];
    for (const p of shuffle(COMMON_PARTICLES, ctx.rng)) if (!wrong.includes(p)) wrong.push(p);
    const options = [...new Set(wrong.filter((w) => norm(w) !== norm(particle)))];
    return build('particle', item, ctx, {
      prompt,
      instruction: `Chọn tiểu từ đúng · ${item.meaning}`,
      correct: particle,
      wrong: options,
      explanation: `${item.text} = ${item.meaning}${exampleOf(item)}`,
    });
  },
};

// ---------- Tìm lỗi collocation ----------

/** Correct example sentences other than the item's own wrong ones, item first, then same type. */
function correctSentences(item: BattleItem, pool: readonly BattleItem[], rng: Rng): string[] {
  const own = item.examples.map((e) => e.en);
  const others = pickDistractors(item, pool, rng, OPTION_COUNT, (p) => p.examples[0]?.en ?? null, own);
  return [...own, ...others];
}

export const errorSpotGenerator: QuestionGenerator = {
  kind: 'errorSpot',
  label: 'Tìm câu dùng sai',
  canGenerate: (item, pool) =>
    (item.distractors?.wrongSentences.length ?? 0) > 0 && item.examples.length + pool.filter((p) => p.id !== item.id && p.examples.length).length >= OPTION_COUNT - 1,
  generate: (item, ctx) => {
    const wrongSentence = shuffle(item.distractors?.wrongSentences ?? [], ctx.rng)[0];
    if (!wrongSentence) return null;
    const right = correctSentences(item, ctx.pool, ctx.rng).filter((s) => norm(s) !== norm(wrongSentence));
    return build('errorSpot', item, ctx, {
      prompt: item.text,
      instruction: 'Câu nào dùng SAI?',
      // The "correct answer" of this question is the wrong sentence.
      correct: wrongSentence,
      wrong: right,
      explanation: `✗ ${wrongSentence} → ✓ ${item.examples[0]?.en ?? item.text} (${item.meaning})`,
    });
  },
};

// ---------- Idiom theo ngữ cảnh ----------

const situationOf = (item: BattleItem) => item.examples.find((e) => e.vi.trim())?.vi ?? null;

export const idiomContextGenerator: QuestionGenerator = {
  kind: 'idiomContext',
  label: 'Idiom theo tình huống',
  canGenerate: (item) => item.type === 'idiom' && situationOf(item) !== null,
  generate: (item, ctx) => {
    const situation = situationOf(item);
    if (item.type !== 'idiom' || !situation) return null;
    // Other idioms first (same type), then other phrases.
    const wrong = pickDistractors(item, ctx.pool.filter((p) => p.type !== 'word'), ctx.rng, OPTION_COUNT - 1, (p) => p.text, [item.text]);
    const more = wrong.length < OPTION_COUNT - 1 ? pickDistractors(item, ctx.pool, ctx.rng, OPTION_COUNT - 1 - wrong.length, (p) => p.text, [item.text, ...wrong]) : [];
    return build('idiomContext', item, ctx, {
      prompt: situation,
      instruction: 'Idiom nào hợp với tình huống?',
      correct: item.text,
      wrong: [...wrong, ...more],
      explanation: `${item.text} = ${item.meaning}${exampleOf(item)}`,
    });
  },
};

export const GENERATORS: readonly QuestionGenerator[] = [
  meaningGenerator,
  clozeGenerator,
  collocationGenerator,
  particleGenerator,
  errorSpotGenerator,
  idiomContextGenerator,
];

export const GENERATOR_BY_KIND = new Map(GENERATORS.map((g) => [g.kind, g]));

/**
 * A question of one of the enabled kinds the item supports (picked at random); when none fits,
 * fall back to Nghĩa, then Cloze.
 */
export function generateQuestion(item: BattleItem, kinds: readonly QuestionKind[], ctx: GenContext): Question {
  const candidates = shuffle(
    GENERATORS.filter((g) => kinds.includes(g.kind) && g.canGenerate(item, ctx.pool)),
    ctx.rng,
  );
  for (const g of [...candidates, meaningGenerator, clozeGenerator]) {
    const q = g.generate(item, ctx);
    if (q) return q;
  }
  // Tiny pools (fewer than 4 distinct meanings): repeat-free fallback is impossible, so pad options.
  const wrong = pickDistractors(item, ctx.pool, ctx.rng, OPTION_COUNT - 1, (p) => p.meaning, [item.meaning]);
  const options = shuffle([item.meaning, ...wrong], ctx.rng);
  return {
    id: `q${ctx.seq}-${item.id}`,
    itemId: item.id,
    kind: 'meaning',
    prompt: item.text,
    instruction: 'Chọn nghĩa đúng',
    options,
    correctIndex: options.indexOf(item.meaning),
    explanation: `${item.text} = ${item.meaning}`,
  };
}
