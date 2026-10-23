import type { BattleItem } from '../data/words';
import { mulberry32, shuffle } from '../game/rng';
import { makeCloze } from '../study/cloze';
import { normalizeAnswer, normalizeChar } from './input';
import type { ContentKind, FieldState, FieldEventType, Outcome, TypingCard, TypingTarget } from './types';

export const POOL_SIZE = 24;
export const MILESTONES = 20;
export const CARDS_PER_MILESTONE = 4;
export const DEFAULT_HEARTS = 3;
export const HINT_PENALTY = 15;
export const ATTACK_SPEED = 1.6;

/** Card text and answer for each item; cloze falls back to "meaning" when no example contains the item. */
export function prepareTargets(items: readonly BattleItem[], content: ContentKind): TypingTarget[] {
  return items
    .filter((it) => it.text.trim() && it.meaning.trim())
    .map((item) => {
      if (content === 'cloze') {
        const cloze = makeCloze(item);
        if (cloze) return { item, kind: 'cloze', display: cloze.sentence, answer: normalizeAnswer(cloze.answer) };
        return { item, kind: 'meaning', display: item.meaning, answer: normalizeAnswer(item.text) };
      }
      const display = content === 'copy' ? item.text : content === 'meaning' ? item.meaning : '';
      return { item, kind: content, display, answer: normalizeAnswer(item.text) };
    });
}

/** Speed (field heights per second), cards on screen and seconds between spawns for a milestone (1–20). */
export function difficulty(milestone: number, maxActiveCap = 8) {
  const m = Math.min(Math.max(milestone, 1), MILESTONES);
  return {
    speed: 0.055 + 0.006 * (m - 1),
    maxActive: Math.min(maxActiveCap, 2 + Math.floor(m / 4)),
    spawnInterval: Math.max(0.9, 2.6 - 0.09 * (m - 1)),
  };
}

export interface FieldOptions {
  items: readonly BattleItem[];
  content: ContentKind;
  seed: number;
  hearts?: number;
  /** Fewer cards at once on small screens. */
  maxActiveCap?: number;
}

function emptyCard(): TypingCard {
  return { active: false, serial: 0, target: 0, x: 0, y: 0, speed: 0, typed: 0, mistakes: 0, hints: 0, attack: false, shake: 0 };
}

/** A new field. The same seed gives the same order and positions of falling cards on every device. */
export function createField(opts: FieldOptions): FieldState {
  const targets = prepareTargets(opts.items, opts.content);
  if (targets.length === 0) throw new Error('No items to type');
  const spawnRng = mulberry32(opts.seed);
  return {
    targets,
    cards: Array.from({ length: POOL_SIZE }, emptyCard),
    locked: -1,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hearts: opts.hearts ?? DEFAULT_HEARTS,
    resolved: 0,
    milestone: 1,
    keys: { correct: 0, total: 0 },
    chars: 0,
    elapsed: 0,
    spawnTimer: 0.6,
    order: shuffle(
      targets.map((_, i) => i),
      spawnRng,
    ),
    orderPos: 0,
    lastTarget: -1,
    outcomes: new Map(),
    outbox: 0,
    events: [],
    over: null,
    maxActiveCap: opts.maxActiveCap ?? 8,
    serial: 0,
    spawnRng,
    attackRng: mulberry32((opts.seed ^ 0x9e3779b9) >>> 0),
  };
}

function emit(s: FieldState, type: FieldEventType, card: number) {
  const c = card >= 0 ? s.cards[card] : null;
  s.events.push({ type, x: c?.x ?? 0.5, y: c?.y ?? 1, card });
}

const activeCount = (s: FieldState) => s.cards.reduce((n, c) => n + (c.active ? 1 : 0), 0);

function freeSlot(s: FieldState): number {
  return s.cards.findIndex((c) => !c.active);
}

function nextTarget(s: FieldState): number {
  if (s.orderPos >= s.order.length) {
    // Reshuffle; avoid repeating the last card right away.
    s.order = shuffle(s.order, s.spawnRng);
    if (s.order.length > 1 && s.order[0] === s.lastTarget) [s.order[0], s.order[s.order.length - 1]] = [s.order[s.order.length - 1], s.order[0]];
    s.orderPos = 0;
  }
  const t = s.order[s.orderPos++];
  s.lastTarget = t;
  return t;
}

function place(s: FieldState, slot: number, target: number, x: number, speed: number, attack: boolean) {
  const c = s.cards[slot];
  c.active = true;
  c.serial = ++s.serial;
  c.target = target;
  c.x = x;
  c.y = 0;
  c.speed = speed;
  c.typed = 0;
  c.mistakes = 0;
  c.hints = 0;
  c.attack = attack;
  c.shake = 0;
  emit(s, 'spawn', slot);
}

function spawn(s: FieldState) {
  const slot = freeSlot(s);
  // Always draw the same number of random values so both players' sequences stay identical.
  const target = nextTarget(s);
  const r1 = s.spawnRng();
  const r2 = s.spawnRng();
  if (slot < 0) return;
  const { speed } = difficulty(s.milestone);
  place(s, slot, target, 0.14 + r1 * 0.72, speed * (0.85 + r2 * 0.3), false);
}

/** Cards sent by the opponent: random items, faster, red border. They do not count for milestones. */
export function injectAttacks(s: FieldState, count: number) {
  for (let i = 0; i < count; i++) {
    const target = Math.floor(s.attackRng() * s.targets.length);
    const x = 0.14 + s.attackRng() * 0.72;
    const slot = freeSlot(s);
    if (slot < 0 || s.over) return;
    place(s, slot, target, x, difficulty(s.milestone).speed * ATTACK_SPEED, true);
  }
}

function record(s: FieldState, target: number, outcome: Outcome) {
  const rank = { clean: 0, assisted: 1, missed: 2 };
  const cur = s.outcomes.get(target);
  if (!cur || rank[outcome] > rank[cur]) s.outcomes.set(target, outcome);
}

function resolveSequenceCard(s: FieldState, card: TypingCard) {
  if (card.attack) return;
  s.resolved++;
  const m = Math.min(MILESTONES, 1 + Math.floor(s.resolved / CARDS_PER_MILESTONE));
  if (m > s.milestone) {
    s.milestone = m;
    emit(s, 'milestone', -1);
  }
  if (s.resolved >= MILESTONES * CARDS_PER_MILESTONE && !s.over) s.over = 'cleared';
}

/** Advance the field by dt seconds: spawn, fall, lose hearts at the bottom line. */
export function step(s: FieldState, dt: number) {
  if (s.over) return;
  s.elapsed += dt;
  const { maxActive, spawnInterval } = difficulty(s.milestone, s.maxActiveCap);
  s.spawnTimer -= dt;
  if (s.spawnTimer <= 0) {
    if (activeCount(s) < maxActive) {
      spawn(s);
      s.spawnTimer = spawnInterval;
    } else s.spawnTimer = 0.2;
  }
  for (let i = 0; i < s.cards.length; i++) {
    const c = s.cards[i];
    if (!c.active) continue;
    c.y += c.speed * dt;
    if (c.shake > 0) c.shake = Math.max(0, c.shake - dt);
    if (c.y >= 1) {
      c.active = false;
      if (s.locked === i) s.locked = -1;
      s.hearts--;
      s.combo = 0;
      record(s, c.target, 'missed');
      emit(s, 'miss', i);
      resolveSequenceCard(s, c);
      if (s.hearts <= 0) {
        s.hearts = 0;
        s.over = 'dead';
        return;
      }
    }
  }
}

/** Bottom-most active card whose answer starts with `ch` (or any card when ch is null). */
export function pickTarget(s: FieldState, ch: string | null): number {
  let best = -1;
  for (let i = 0; i < s.cards.length; i++) {
    const c = s.cards[i];
    if (!c.active) continue;
    if (ch !== null && s.targets[c.target].answer[0] !== ch) continue;
    if (best < 0 || c.y > s.cards[best].y) best = i;
  }
  return best;
}

function destroy(s: FieldState, slot: number) {
  const c = s.cards[slot];
  const t = s.targets[c.target];
  s.score += Math.round(t.answer.length * 10 * (1 + s.combo / 10));
  s.combo++;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  // Combo 5 sends one attack card, combo 10 (and every 5 after) sends two.
  if (s.combo === 5) s.outbox += 1;
  else if (s.combo >= 10 && s.combo % 5 === 0) s.outbox += 2;
  record(s, c.target, c.mistakes > 0 || c.hints > 0 ? 'assisted' : 'clean');
  emit(s, 'kill', slot);
  c.active = false;
  s.locked = -1;
  resolveSequenceCard(s, c);
}

/** One typed character (already normalized or raw; spaces count). Returns whether it was right. */
export function typeChar(s: FieldState, raw: string): boolean {
  if (s.over) return false;
  const ch = normalizeChar(raw);
  if (ch.length !== 1) return false;
  s.keys.total++;
  if (s.locked < 0) {
    const slot = pickTarget(s, ch);
    if (slot < 0) {
      s.combo = 0;
      emit(s, 'wrong', -1);
      return false;
    }
    s.locked = slot;
  }
  const c = s.cards[s.locked];
  const answer = s.targets[c.target].answer;
  if (answer[c.typed] === ch) {
    s.keys.correct++;
    s.chars++;
    c.typed++;
    emit(s, 'type', s.locked);
    if (c.typed >= answer.length) destroy(s, s.locked);
    return true;
  }
  c.mistakes++;
  c.shake = 0.3;
  s.combo = 0;
  emit(s, 'wrong', s.locked);
  return false;
}

/** Remove the last typed character; at zero the card is unlocked. */
export function backspace(s: FieldState) {
  if (s.locked < 0) return;
  const c = s.cards[s.locked];
  if (c.typed > 0) c.typed--;
  if (c.typed === 0) s.locked = -1;
}

/** Unlock the current card (its typed characters are kept off). */
export function escape(s: FieldState) {
  if (s.locked < 0) return;
  s.cards[s.locked].typed = 0;
  s.locked = -1;
}

/** Reveal the next character of the locked (or bottom-most) card, for a score penalty. */
export function hint(s: FieldState): boolean {
  if (s.over) return false;
  if (s.locked < 0) s.locked = pickTarget(s, null);
  if (s.locked < 0) return false;
  const c = s.cards[s.locked];
  c.hints++;
  c.typed++;
  s.score = Math.max(0, s.score - HINT_PENALTY);
  emit(s, 'hint', s.locked);
  if (c.typed >= s.targets[c.target].answer.length) destroy(s, s.locked);
  return true;
}

/** Words per minute: 5 correct characters = 1 word. */
export function wpm(s: Pick<FieldState, 'chars' | 'elapsed'>): number {
  return s.elapsed > 0 ? Math.round((s.chars / 5 / (s.elapsed / 60)) * 10) / 10 : 0;
}

export function accuracy(s: Pick<FieldState, 'keys'>): number {
  return s.keys.total ? s.keys.correct / s.keys.total : 1;
}

/** Take the attack cards earned since the last call. */
export function takeOutbox(s: FieldState): number {
  const n = s.outbox;
  s.outbox = 0;
  return n;
}
