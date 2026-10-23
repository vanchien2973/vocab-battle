import { VSTEP } from './config';

export interface ClockState {
  /** Whole seconds left (never negative). */
  remaining: number;
  expired: boolean;
  /** 0 normal, 1 under the first warning (5 min), 2 under the last (1 min). */
  warnLevel: number;
}

export function clockState(deadline: number, now: number, warnAt: readonly number[] = VSTEP.warnAtSeconds): ClockState {
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return { remaining, expired: remaining === 0, warnLevel: warnAt.filter((w) => remaining <= w).length };
}

export const formatClock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export interface ClockEvents {
  onTick?: (s: ClockState) => void;
  /** Called once per threshold (seconds left) when the time drops to it. */
  onWarn?: (threshold: number) => void;
  /** Called once when time runs out. */
  onExpire?: () => void;
}

/**
 * Countdown to a fixed deadline (wall clock, so it keeps running while the tab is closed and survives
 * a restored draft). Thresholds already passed at start do not warn again.
 */
export class WritingClock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private warned = new Set<number>();
  private expired = false;

  constructor(
    readonly deadline: number,
    private readonly events: ClockEvents,
    private readonly warnAt: readonly number[] = VSTEP.warnAtSeconds,
    private readonly now: () => number = Date.now,
  ) {
    const s = clockState(deadline, now(), warnAt);
    for (const w of warnAt) if (s.remaining <= w) this.warned.add(w);
  }

  start(intervalMs = 250): this {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): ClockState {
    const s = clockState(this.deadline, this.now(), this.warnAt);
    for (const w of this.warnAt) {
      if (s.remaining <= w && !this.warned.has(w) && !s.expired) {
        this.warned.add(w);
        this.events.onWarn?.(w);
      }
    }
    this.events.onTick?.(s);
    if (s.expired && !this.expired) {
      this.expired = true;
      this.stop();
      this.events.onExpire?.();
    }
    return s;
  }
}

/** Exam mode submits by itself when time is up; practice asks first. */
export const autoSubmitsOnExpire = (mode: string) => mode === 'exam';
