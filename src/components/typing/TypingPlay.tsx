import { useEffect, useRef, useState } from 'react';
import type { BotLevel } from '../../controllers/bot';
import type { BattleItem } from '../../data/words';
import { createTypingBot } from '../../typing/bot';
import { accuracy, backspace, createField, escape, hint, injectAttacks, pickTarget, typeChar, wpm } from '../../typing/engine';
import { diffInput, looksVietnameseIme } from '../../typing/input';
import { miniCards, TypingLoop } from '../../typing/loop';
import { drawMini, FieldRenderer } from '../../typing/render';
import { unlockAudio } from '../../typing/sound';
import { setMuted, useTypingHud, type MiniCard, type OpponentView } from '../../typing/store';
import type { ContentKind, FieldState, Outcome } from '../../typing/types';
import { speak } from '../prepare/speech';

export type TypingRule = 'hearts' | 'race';
export const RACE_HEARTS = 99;

/** Online peer as seen by the play screen (implemented over the PeerJS session). */
export interface RemoteLink {
  opponentName: string;
  sendStatus(status: { score: number; milestone: number; hearts: number; combo: number; wpm: number; cards: MiniCard[] }): void;
  sendAttack(count: number): void;
  reportDone(reason: 'dead' | 'race', milestone: number): void;
  onAttack(cb: (count: number) => void): () => void;
  /** The host decided the match. */
  onOver(cb: (won: boolean, reason: string) => void): () => void;
  onOpponent(cb: (view: OpponentView) => void): () => void;
}

export interface TypingResultData {
  result: 'win' | 'lose' | 'cleared' | 'dead' | 'quit';
  reason?: string;
  score: number;
  milestone: number;
  wpm: number;
  accuracy: number;
  maxCombo: number;
  content: ContentKind;
  mode: 'solo' | 'bot' | 'online';
  /** Worst outcome per item that appeared. */
  outcomes: { item: BattleItem; outcome: Outcome }[];
}

interface Props {
  items: BattleItem[];
  content: ContentKind;
  seed: number;
  rule: TypingRule;
  mode: 'solo' | 'bot' | 'online';
  botLevel?: BotLevel;
  remote?: RemoteLink;
  deckLabel: string;
  onFinish: (r: TypingResultData) => void;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const STATUS_EVERY = 0.2;

function summarize(field: FieldState, base: Pick<TypingResultData, 'result' | 'content' | 'mode' | 'reason'>): TypingResultData {
  return {
    ...base,
    score: field.score,
    milestone: field.milestone,
    wpm: wpm(field),
    accuracy: accuracy(field),
    maxCombo: field.maxCombo,
    outcomes: [...field.outcomes].map(([t, outcome]) => ({ item: field.targets[t].item, outcome })),
  };
}

/** The game screen: canvas field, HUD, hidden input for (virtual) keyboards, opponent mini field. */
export function TypingPlay({ items, content, seed, rule, mode, botLevel, remote, deckLabel, onFinish }: Props) {
  const hud = useTypingHud();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loopRef = useRef<TypingLoop | null>(null);
  const fieldRef = useRef<FieldState | null>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const lastValue = useRef('');
  const composing = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);
  const [keyboard, setKeyboard] = useState(true);

  const finish = (result: TypingResultData['result'], reason?: string) => {
    if (finished.current || !fieldRef.current) return;
    finished.current = true;
    loopRef.current?.stop();
    // Leaving an online match counts as losing; the host announces it to both sides.
    if (remote && result === 'quit') remote.reportDone('dead', fieldRef.current.milestone);
    loopRef.current?.pushHud();
    onFinish(summarize(fieldRef.current, { result, reason, content, mode }));
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Build the field and start the loop once.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new FieldRenderer(canvas, reducedMotion());
    rendererRef.current = renderer;
    const hearts = rule === 'race' ? RACE_HEARTS : 3;
    const field = createField({ items, content, seed, hearts, maxActiveCap: renderer.maxActiveCap });
    fieldRef.current = field;
    const bot =
      mode === 'bot' && botLevel ? { field: createField({ items, content, seed, hearts, maxActiveCap: renderer.maxActiveCap }), bot: createTypingBot(botLevel, seed) } : undefined;
    useTypingHud.setState({
      paused: false,
      imeWarning: false,
      focusWarning: false,
      opponent: bot ? { name: `Bot`, score: 0, milestone: 1, hearts, combo: 0, wpm: 0, cards: [] } : remote ? { name: remote.opponentName, score: 0, milestone: 1, hearts, combo: 0, wpm: 0, cards: [] } : null,
    });

    let statusTimer = 0;
    const loop = new TypingLoop({
      field,
      renderer,
      bot,
      onAttack: (n) => remote?.sendAttack(n),
      onSpawn: (slot) => {
        const t = field.targets[field.cards[slot].target];
        if (t.kind === 'listen' && !useTypingHud.getState().muted) speak(t.item.text);
      },
      onTick: () => {
        if (bot) {
          if (bot.field.over === 'dead') finishRef.current('win', 'Bot hết tim');
          else if (bot.field.over === 'cleared') finishRef.current('lose', 'Bot qua mốc 20 trước');
        }
        if (remote) {
          statusTimer += 1 / 60;
          if (statusTimer >= STATUS_EVERY) {
            statusTimer = 0;
            remote.sendStatus({ score: field.score, milestone: field.milestone, hearts: field.hearts, combo: field.combo, wpm: wpm(field), cards: miniCards(field) });
          }
        }
      },
      onOver: () => {
        if (remote) {
          // Online: the host decides; report and wait for typingOver.
          remote.reportDone(field.over === 'dead' ? 'dead' : 'race', field.milestone);
          return;
        }
        if (mode === 'bot') finishRef.current(field.over === 'cleared' ? 'win' : 'lose', field.over === 'cleared' ? 'Qua mốc 20 trước Bot' : 'Hết tim');
        else finishRef.current(field.over === 'cleared' ? 'cleared' : 'dead');
      },
    });
    loopRef.current = loop;
    loop.start();

    const unsub: (() => void)[] = [];
    if (remote) {
      unsub.push(remote.onAttack((n) => injectAttacks(field, n)));
      unsub.push(remote.onOver((won, reason) => finishRef.current(won ? 'win' : 'lose', reason)));
      unsub.push(remote.onOpponent((view) => useTypingHud.setState({ opponent: view })));
    }

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas);
    inputRef.current?.focus();
    return () => {
      loop.stop();
      ro.disconnect();
      unsub.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opponent mini field.
  useEffect(() => {
    if (miniRef.current && hud.opponent) drawMini(miniRef.current, hud.opponent.cards);
  }, [hud.opponent]);

  // Pause when the tab is hidden or loses focus (online: warn only, the match goes on).
  useEffect(() => {
    const away = () => {
      if (finished.current) return;
      if (mode === 'online') useTypingHud.setState({ focusWarning: true });
      else pause();
    };
    const back = () => useTypingHud.setState({ focusWarning: false });
    const onVis = () => (document.visibilityState === 'hidden' ? away() : back());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the bottom line above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !wrapRef.current) return;
    const apply = () => wrapRef.current?.style.setProperty('--vvh', `${vv.height}px`);
    apply();
    vv.addEventListener('resize', apply);
    return () => vv.removeEventListener('resize', apply);
  }, []);

  function pause() {
    if (mode === 'online' || finished.current) return;
    loopRef.current?.stop();
    useTypingHud.setState({ paused: true });
  }

  function resume() {
    useTypingHud.setState({ paused: false });
    loopRef.current?.start();
    inputRef.current?.focus();
  }

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
    lastValue.current = '';
  };

  /** Apply what changed in the hidden input since last time (works with IMEs and mobile keyboards). */
  const syncInput = () => {
    const field = fieldRef.current;
    const el = inputRef.current;
    if (!field || !el || composing.current || hud.paused) return;
    const value = el.value;
    if (looksVietnameseIme(value)) useTypingHud.setState({ imeWarning: true });
    const { backspaces, chars } = diffInput(lastValue.current, value);
    for (let i = 0; i < backspaces; i++) backspace(field);
    for (const ch of chars) typeChar(field, ch);
    lastValue.current = value;
    if (field.locked < 0 || value.length > 40) resetInput();
  };

  const speakTarget = () => {
    const field = fieldRef.current;
    if (!field) return;
    const slot = field.locked >= 0 ? field.locked : pickTarget(field, null);
    if (slot >= 0) speak(field.targets[field.cards[slot].target].item.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const field = fieldRef.current;
    if (!field || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      escape(field);
      resetInput();
    } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault();
      backspace(field);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      speakTarget();
    } else if (e.key === '?') {
      // Hold "?" for one second to reveal the next letter.
      e.preventDefault();
      if (!hintTimer.current) hintTimer.current = setTimeout(() => fieldRef.current && hint(fieldRef.current), 1000);
    } else if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === '?' || e.key === '/' || e.key === 'Shift') && hintTimer.current) {
      clearTimeout(hintTimer.current);
      hintTimer.current = null;
    }
  };

  const toggleKeyboard = () => {
    if (keyboard) inputRef.current?.blur();
    else inputRef.current?.focus();
    setKeyboard(!keyboard);
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
    inputRef.current?.focus();
  };

  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    unlockAudio();
    if (keyboard) inputRef.current?.focus();
    const field = fieldRef.current;
    const r = rendererRef.current;
    if (!field || !r) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const slot = r.hitTest(field, e.clientX - rect.left, e.clientY - rect.top);
    if (slot >= 0) {
      const t = field.targets[field.cards[slot].target];
      if (t.kind === 'listen') speak(t.item.text);
    }
  };

  const hearts = hud.hearts >= RACE_HEARTS - 10 ? '∞' : '❤️'.repeat(Math.max(0, hud.hearts));

  return (
    <div className="typing-play" ref={wrapRef}>
      <div className="typing-hud">
        <button type="button" className="icon-btn" aria-label="Thoát" title="Thoát" onClick={() => finish('quit')}>
          ✕
        </button>
        {mode !== 'online' && (
          <button type="button" className="icon-btn" aria-label={hud.paused ? 'Tiếp tục' : 'Tạm dừng'} onClick={() => (hud.paused ? resume() : pause())}>
            {hud.paused ? '▶' : '⏸'}
          </button>
        )}
        <span className="hud-stat">
          <strong>{hud.score}</strong> điểm
        </span>
        <span className="hud-stat" title={deckLabel}>
          Mốc <strong>{hud.milestone}</strong>/20 · <span className="hud-deck">{deckLabel}</span>
        </span>
        <span className="hud-stat">{hearts}</span>
        <span className="hud-stat">
          x<strong>{hud.combo}</strong>
        </span>
        <span className="hud-stat">
          <strong>{Math.round(hud.wpm)}</strong> WPM
        </span>
        <span className="hud-tools">
          <button type="button" className="icon-btn" aria-label="Gợi ý (giữ ? 1 giây)" title="Gợi ý: lộ ký tự kế tiếp (giữ ? 1 giây)" onClick={() => fieldRef.current && hint(fieldRef.current)}>
            💡
          </button>
          <button type="button" className="icon-btn" aria-label={keyboard ? 'Ẩn bàn phím' : 'Hiện bàn phím'} title="Ẩn/hiện bàn phím ảo" onClick={toggleKeyboard}>
            ⌨️
          </button>
          <button type="button" className="icon-btn" aria-label={hud.muted ? 'Bật âm thanh' : 'Tắt âm thanh'} onClick={() => setMuted(!hud.muted)}>
            {hud.muted ? '🔇' : '🔊'}
          </button>
          <button type="button" className="icon-btn" aria-label="Toàn màn hình" onClick={toggleFullscreen}>
            ⛶
          </button>
        </span>
      </div>

      {hud.imeWarning && (
        <p className="typing-warning" onClick={() => useTypingHud.setState({ imeWarning: false })}>
          ⚠️ Hãy tắt bộ gõ tiếng Việt (Telex/VNI) để gõ tiếng Anh chính xác.
        </p>
      )}
      {hud.focusWarning && <p className="typing-warning">⚠️ Trận online vẫn đang chạy – quay lại cửa sổ này!</p>}

      <div className={`typing-arena ${hud.opponent ? 'versus' : ''}`}>
        {hud.opponent && <OpponentPanel view={hud.opponent} canvasRef={miniRef} />}
        <ul className="sr-only typing-visible" aria-live="polite">
          {hud.visible.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <canvas ref={canvasRef} className="typing-canvas" onPointerDown={onCanvasPointer} aria-label="Sân chơi: gõ từ trên thẻ đang rơi" />
      </div>

      <input
        ref={inputRef}
        className="typing-input"
        type="text"
        lang="en"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="Ô gõ"
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onInput={syncInput}
        onCompositionStart={() => {
          composing.current = true;
          useTypingHud.setState({ imeWarning: true });
        }}
        onCompositionEnd={() => {
          composing.current = false;
          syncInput();
        }}
        onFocus={unlockAudio}
      />

      {hud.paused && (
        <div className="overlay">
          <div className="card typing-paused">
            <h2>⏸ Tạm dừng</h2>
            <button type="button" className="btn primary big" onClick={resume}>
              ▶ Tiếp tục
            </button>
            <button type="button" className="btn ghost" onClick={() => finish('quit')}>
              Kết thúc
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpponentPanel({ view, canvasRef }: { view: OpponentView; canvasRef: React.RefObject<HTMLCanvasElement> }) {
  return (
    <div className="typing-opponent">
      <div className="small">
        <strong>{view.name}</strong> · {view.score} điểm · mốc {view.milestone} · {view.hearts >= RACE_HEARTS - 10 ? '∞' : `❤️${view.hearts}`} · x{view.combo} · {Math.round(view.wpm)} WPM
      </div>
      <canvas ref={canvasRef} className="typing-mini" aria-label={`Sân của ${view.name}`} />
    </div>
  );
}
