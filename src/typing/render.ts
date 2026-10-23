import type { MiniCard } from './store';
import type { FieldEvent, FieldState, TypingCard } from './types';

const C = {
  bg: '#0b1024',
  star: '#c9d3ff',
  card: '#252d4d',
  border: '#4a5590',
  attack: '#ff5c6c',
  text: '#eef1ff',
  meaning: '#ffcc4d',
  typed: '#3ddc84',
  rest: '#9aa3c7',
  line: '#ff5c6c55',
  ship: '#5b7cfa',
  laser: '#7df9ff',
};

const SHIP_ZONE = 46;
const MAX_PARTICLES = 90;
const MAX_LASERS = 6;
const STAR_COUNT = 70;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface Laser {
  x: number;
  y: number;
  life: number;
}

interface Layout {
  serial: number;
  lines: string[];
  progress: boolean;
  w: number;
  h: number;
}

/**
 * Canvas 2D view of one field. Effects (particles, lasers) live in fixed-size pools; card layouts are
 * cached per spawn so a frame only measures text when a new card appears.
 */
export class FieldRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private font = 16;
  private particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: '' }));
  private lasers: Laser[] = Array.from({ length: MAX_LASERS }, () => ({ x: 0, y: 0, life: 0 }));
  private stars = Array.from({ length: STAR_COUNT }, (_, i) => ({ x: (i * 97) % 100 / 100, y: (i * 61) % 100 / 100, r: (i % 3) * 0.5 + 0.5 }));
  private layouts: (Layout | null)[] = [];
  private time = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: boolean,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.font = Math.round(Math.min(22, Math.max(14, Math.min(this.w, this.h) * 0.034)));
    this.layouts = [];
  }

  /** How many cards fit side by side; the engine uses it to cap cards on screen. */
  get maxActiveCap(): number {
    return this.w < 420 ? 3 : this.w < 700 ? 5 : 8;
  }

  private get lineY() {
    return this.h - SHIP_ZONE;
  }

  /** Card center in pixels. */
  cardCenter(card: TypingCard, layout: { w: number; h: number }) {
    const x = Math.min(this.w - layout.w / 2 - 4, Math.max(layout.w / 2 + 4, card.x * this.w));
    const y = layout.h / 2 + 4 + card.y * (this.lineY - layout.h - 4);
    return { x, y };
  }

  /** The card slot under a point (for tapping listening cards). */
  hitTest(field: FieldState, px: number, py: number): number {
    for (let i = 0; i < field.cards.length; i++) {
      const c = field.cards[i];
      const l = this.layouts[i];
      if (!c.active || !l) continue;
      const { x, y } = this.cardCenter(c, l);
      if (Math.abs(px - x) <= l.w / 2 && Math.abs(py - y) <= l.h / 2) return i;
    }
    return -1;
  }

  private layout(field: FieldState, slot: number): Layout {
    const card = field.cards[slot];
    const cached = this.layouts[slot];
    if (cached && cached.serial === card.serial) return cached;
    const ctx = this.ctx;
    const t = field.targets[card.target];
    const maxW = Math.min(this.w * 0.62, 420);
    const pad = 12;
    ctx.font = `600 ${this.font}px system-ui, sans-serif`;
    let lines: string[];
    let progress = true;
    if (t.kind === 'copy') {
      lines = [t.item.text.replace(/\s+/g, ' ').trim()];
      progress = false;
    } else if (t.kind === 'listen') lines = ['🔊 ?'];
    else lines = wrap(ctx, t.display, maxW - pad * 2, 3);
    let w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (progress) {
      ctx.font = `600 ${this.font}px ui-monospace, monospace`;
      w = Math.max(w, ctx.measureText(progressText(t.answer, 0)).width);
    }
    const lh = this.font * 1.3;
    const layout = { serial: card.serial, lines, progress, w: Math.min(maxW, w + pad * 2), h: lh * (lines.length + (progress ? 1 : 0)) + 12 };
    this.layouts[slot] = layout;
    return layout;
  }

  /** Turn engine events into effects. Call before draw; the caller clears field.events afterwards. */
  handleEvents(field: FieldState, events: readonly FieldEvent[]) {
    if (this.reducedMotion) return;
    for (const e of events) {
      if (e.type !== 'kill' || e.card < 0) continue;
      const l = this.layouts[e.card];
      const pos = l ? this.cardCenter(field.cards[e.card], l) : { x: e.x * this.w, y: e.y * this.lineY };
      const laser = this.lasers.find((z) => z.life <= 0);
      if (laser) {
        laser.x = pos.x;
        laser.y = pos.y;
        laser.life = 0.18;
      }
      let n = 0;
      for (const p of this.particles) {
        if (p.life > 0) continue;
        const a = (n / 14) * Math.PI * 2;
        const v = 60 + ((n * 37) % 90);
        p.x = pos.x;
        p.y = pos.y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.life = 0.6;
        p.color = n % 2 ? C.typed : C.meaning;
        if (++n === 14) break;
      }
    }
  }

  draw(field: FieldState, dt: number) {
    const ctx = this.ctx;
    this.time += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // Stars drift slowly downwards.
    ctx.fillStyle = C.star;
    const drift = this.reducedMotion ? 0 : this.time * 0.01;
    for (const s of this.stars) {
      const y = ((s.y + drift * s.r) % 1) * this.h;
      ctx.globalAlpha = 0.25 + s.r * 0.3;
      ctx.fillRect(s.x * this.w, y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Bottom line and ship.
    ctx.strokeStyle = C.line;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, this.lineY);
    ctx.lineTo(this.w, this.lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    const shipX = this.w / 2;
    const shipY = this.h - 14;
    ctx.fillStyle = C.ship;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY - 22);
    ctx.lineTo(shipX - 16, shipY);
    ctx.lineTo(shipX + 16, shipY);
    ctx.closePath();
    ctx.fill();

    // Lasers.
    ctx.strokeStyle = C.laser;
    ctx.lineWidth = 3;
    for (const z of this.lasers) {
      if (z.life <= 0) continue;
      z.life -= dt;
      ctx.globalAlpha = Math.max(0, z.life / 0.18);
      ctx.beginPath();
      ctx.moveTo(shipX, shipY - 22);
      ctx.lineTo(z.x, z.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // Cards.
    const lh = this.font * 1.3;
    for (let i = 0; i < field.cards.length; i++) {
      const card = field.cards[i];
      if (!card.active) continue;
      const l = this.layout(field, i);
      const t = field.targets[card.target];
      let { x, y } = this.cardCenter(card, l);
      if (card.shake > 0 && !this.reducedMotion) x += Math.sin(card.shake * 60) * 4;
      const left = x - l.w / 2;
      const top = y - l.h / 2;
      ctx.fillStyle = C.card;
      ctx.strokeStyle = card.attack ? C.attack : C.border;
      ctx.lineWidth = card.attack ? 2.5 : 1;
      roundRect(ctx, left, top, l.w, l.h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let ly = top + 6 + lh / 2;
      ctx.font = `600 ${this.font}px system-ui, sans-serif`;
      if (!l.progress) {
        // "Gõ lại": colour the typed part of the word itself.
        drawSplit(ctx, l.lines[0], card.typed, x, ly);
      } else {
        ctx.fillStyle = t.kind === 'meaning' ? C.meaning : C.text;
        ctx.font = `500 ${Math.round(this.font * 0.92)}px system-ui, sans-serif`;
        for (const line of l.lines) {
          ctx.fillText(line, x, ly);
          ly += lh;
        }
        ctx.font = `600 ${this.font}px ui-monospace, monospace`;
        // Letters separated by thin spaces so the blanks can be counted.
        drawSplit(ctx, progressText(t.answer, card.typed), card.typed * 2, x, ly);
      }

      // Aim brackets around the locked card.
      if (field.locked === i) {
        ctx.strokeStyle = C.typed;
        ctx.lineWidth = 2;
        const m = 5;
        const s = 10;
        const corners: [number, number, number, number][] = [
          [left - m, top - m, 1, 1],
          [left + l.w + m, top - m, -1, 1],
          [left - m, top + l.h + m, 1, -1],
          [left + l.w + m, top + l.h + m, -1, -1],
        ];
        for (const [cx, cy, dx, dy] of corners) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + dy * s);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + dx * s, cy);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
    }

    // Explosion particles.
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, p.life / 0.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }
}

/** "lo_ _ _ _" style progress: typed letters, then one blank per letter (spaces kept), thin-space separated. */
function progressText(answer: string, typed: number): string {
  let out = '';
  for (let i = 0; i < answer.length; i++) {
    const ch = answer[i];
    out += (i ? '\u2009' : '') + (i < typed || ch === ' ' ? ch : '_');
  }
  return out;
}

/** Typed characters green, the rest white, centred on x. */
function drawSplit(ctx: CanvasRenderingContext2D, text: string, typed: number, x: number, y: number) {
  const done = text.slice(0, typed);
  const rest = text.slice(typed);
  const total = ctx.measureText(text).width;
  const start = x - total / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.typed;
  ctx.fillText(done, start, y);
  ctx.fillStyle = C.text;
  ctx.fillText(rest, start + ctx.measureText(done).width, y);
  ctx.textAlign = 'center';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] += '…';
    return kept;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Opponent's field as small blocks (from ~5 status updates per second). */
export function drawMini(canvas: HTMLCanvasElement, cards: readonly MiniCard[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const w = rect.width;
  const h = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(0, h - 8);
  ctx.lineTo(w, h - 8);
  ctx.stroke();
  for (const [x, y, attack] of cards) {
    ctx.fillStyle = attack ? C.attack : C.border;
    ctx.fillRect(x * w - 10, 4 + y * (h - 20), 20, 8);
  }
}
