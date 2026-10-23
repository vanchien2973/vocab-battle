import { stepBot, type TypingBot } from './bot';
import { accuracy, injectAttacks, step, takeOutbox, wpm } from './engine';
import type { FieldRenderer } from './render';
import { playSound } from './sound';
import { useTypingHud, type MiniCard } from './store';
import type { FieldState } from './types';

export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;
const HUD_EVERY = 0.1;

export interface LoopOptions {
  field: FieldState;
  renderer: FieldRenderer;
  /** Local opponent (vs Bot): its own field, stepped with the bot each tick. */
  bot?: { field: FieldState; bot: TypingBot };
  /** Attack cards the player earned (online: send to the peer). Vs Bot they go straight to the bot's field. */
  onAttack?: (count: number) => void;
  /** Called once when the player's field is over. */
  onOver?: () => void;
  /** Called every tick after stepping (online status, race checks). */
  onTick?: () => void;
  /** Speech for new listening cards. */
  onSpawn?: (slot: number) => void;
}

/** Mini-map snapshot of a field (≤ 16 cards). */
export function miniCards(field: FieldState): MiniCard[] {
  const out: MiniCard[] = [];
  for (const c of field.cards) if (c.active && out.length < 16) out.push([Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100, c.attack ? 1 : 0]);
  return out;
}

/** What the cards show (not the hidden answers), bottom-most first. */
export function visibleTexts(field: FieldState): string[] {
  return field.cards
    .filter((c) => c.active)
    .sort((a, b) => b.y - a.y)
    .map((c) => {
      const t = field.targets[c.target];
      return t.kind === 'listen' ? '🔊' : t.kind === 'copy' ? t.item.text : t.display;
    });
}

/**
 * requestAnimationFrame loop with a fixed 60 Hz simulation step, outside React. React only gets the
 * HUD (store) about ten times a second.
 */
export class TypingLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private hudTimer = 0;
  private running = false;
  private overSent = false;

  constructor(private readonly o: LoopOptions) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  get paused() {
    return !this.running;
  }

  /** Run the simulation directly (tests, or catching up). */
  tick(dt: number) {
    const { field, bot } = this.o;
    step(field, dt);
    if (bot) {
      step(bot.field, dt);
      stepBot(bot.bot, bot.field, dt);
      const fromBot = takeOutbox(bot.field);
      if (fromBot) injectAttacks(field, fromBot);
    }
    const sent = takeOutbox(field);
    if (sent) {
      if (bot) injectAttacks(bot.field, sent);
      this.o.onAttack?.(sent);
    }
    this.o.onTick?.();
    if (field.over && !this.overSent) {
      this.overSent = true;
      this.pushHud();
      this.o.onOver?.();
    }
  }

  pushHud() {
    const { field, bot } = this.o;
    const prev = useTypingHud.getState();
    useTypingHud.setState({
      score: field.score,
      milestone: field.milestone,
      hearts: field.hearts,
      combo: field.combo,
      wpm: wpm(field),
      accuracy: accuracy(field),
      visible: visibleTexts(field),
      opponent: bot
        ? {
            name: prev.opponent?.name ?? 'Bot',
            score: bot.field.score,
            milestone: bot.field.milestone,
            hearts: bot.field.hearts,
            combo: bot.field.combo,
            wpm: wpm(bot.field),
            cards: miniCards(bot.field),
          }
        : prev.opponent,
    });
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(MAX_FRAME, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      this.tick(FIXED_DT);
      this.acc -= FIXED_DT;
    }
    const { field, renderer } = this.o;
    const muted = useTypingHud.getState().muted;
    if (field.events.length) {
      renderer.handleEvents(field, field.events);
      for (const e of field.events) {
        if (!muted) playSound(e.type);
        if (e.type === 'spawn' && e.card >= 0) this.o.onSpawn?.(e.card);
      }
      field.events.length = 0;
    }
    if (this.o.bot) this.o.bot.field.events.length = 0;
    renderer.draw(field, dt);
    this.hudTimer += dt;
    if (this.hudTimer >= HUD_EVERY) {
      this.hudTimer = 0;
      this.pushHud();
    }
    if (field.over) {
      this.running = false;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
