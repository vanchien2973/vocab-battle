import type { FieldEventType } from './types';

type Ctx = AudioContext;
let ctx: Ctx | null = null;

function audio(): Ctx | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const SOUNDS: Partial<Record<FieldEventType, { freq: number; to: number; dur: number; type: OscillatorType; gain: number }>> = {
  type: { freq: 880, to: 880, dur: 0.03, type: 'square', gain: 0.03 },
  wrong: { freq: 160, to: 110, dur: 0.12, type: 'sawtooth', gain: 0.05 },
  kill: { freq: 520, to: 1400, dur: 0.15, type: 'triangle', gain: 0.07 },
  miss: { freq: 300, to: 80, dur: 0.35, type: 'sine', gain: 0.09 },
  hint: { freq: 660, to: 440, dur: 0.1, type: 'sine', gain: 0.04 },
  milestone: { freq: 660, to: 1320, dur: 0.3, type: 'triangle', gain: 0.06 },
};

/** Short synthesized blips (no audio files). Call from a user gesture first so browsers allow audio. */
export function playSound(type: FieldEventType) {
  const s = SOUNDS[type];
  const a = s && audio();
  if (!s || !a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.freq, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(s.to, a.currentTime + s.dur);
  g.gain.setValueAtTime(s.gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + s.dur);
  osc.connect(g).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + s.dur + 0.02);
}

export const unlockAudio = () => void audio();
