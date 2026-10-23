import { useEffect, useState } from 'react';
import { ROUND_TIME_MS } from '../../game/engine';
import { opponentOf, type GameState, type PlayerId } from '../../game/types';
import { useQuestionClock } from '../../hooks/useQuestionClock';
import { useCompactHeader } from '../ai/AiContext';
import { HpBar } from './HpBar';

interface Props {
  state: GameState;
  me: PlayerId;
  onAnswer: (questionId: string, answerIndex: number, ms: number) => void;
  /** Keyboard keys for options 1–4 (desktop). */
  keys?: string[];
  opponentLabel?: string;
  /** Ends the explanation after a round early (omitted where the player cannot pace the match). */
  onSkip?: () => void;
}

/** One player's side of the battle: opponent HP, the question, own HP. */
export function PlayerView({ state, me, onAnswer, keys = ['1', '2', '3', '4'], opponentLabel, onSkip }: Props) {
  useCompactHeader();
  const q = state.question;
  const [picked, setPicked] = useState<{ qid: string; index: number } | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const elapsed = useQuestionClock(q?.id);
  const myPick = picked && picked.qid === q?.id ? picked.index : null;
  const open = state.phase === 'question' && !!q && myPick === null && !timeUp;

  useEffect(() => {
    setTimeUp(false);
    if (state.phase !== 'question') return;
    const t = setTimeout(() => setTimeUp(true), ROUND_TIME_MS);
    return () => clearTimeout(t);
  }, [q?.id, state.phase]);

  const answer = (index: number) => {
    if (!open || !q) return;
    setPicked({ qid: q.id, index });
    onAnswer(q.id, index, elapsed());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = keys.indexOf(e.key);
      if (i >= 0 && !(e.target instanceof HTMLInputElement)) answer(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const result = state.phase !== 'question' ? state.lastResult : null;
  const opp = opponentOf(me);
  let feedback: { text: string; tone: string } | null = null;
  if (result) {
    if (result.attacker === me) feedback = { text: `⚔️ -${result.damage} HP đối thủ!`, tone: 'good' };
    else if (result.attacker === opp)
      feedback = { text: result.players[me].correct ? `Đúng nhưng chậm hơn · -${result.damage} HP` : `💥 -${result.damage} HP`, tone: 'bad' };
    else feedback = { text: result.players[me].answerIndex === null ? '⏰ Hết giờ' : 'Không ai trả lời đúng', tone: 'neutral' };
  }

  return (
    <div className={`player-view ${result?.attacker === opp ? 'hit' : ''}`}>
      <HpBar player={state.players[opp]} label={opponentLabel ?? 'Đối thủ'} small />

      <div className="question">
        {q && (
          <>
            <div className="round-info muted">Câu {state.round}</div>
            <div className="q-instruction muted small">{q.instruction}</div>
            <h2 className={`q-word kind-${q.kind}`}>{q.prompt}</h2>
            {state.phase === 'question' && <div key={q.id} className="timer" style={{ animationDuration: `${ROUND_TIME_MS}ms` }} />}
            <div className="options">
              {q.options.map((opt, i) => {
                let cls = 'option';
                if (result) {
                  if (i === result.correctIndex) cls += ' correct';
                  else if (i === result.players[me].answerIndex) cls += ' wrong';
                } else if (i === myPick) cls += ' picked';
                return (
                  <button key={i} type="button" className={cls} disabled={!open} onClick={() => answer(i)}>
                    <kbd>{keys[i]}</kbd>
                    {opt}
                  </button>
                );
              })}
            </div>
            <div className={`feedback ${feedback?.tone ?? ''}`} aria-live="polite">
              {feedback?.text ?? (myPick !== null ? 'Đã chọn, chờ đối thủ…' : timeUp ? '⏰ Hết giờ' : ' ')}
            </div>
            {result && q.explanation && (
              <div className="explanation">
                <span>💡 {q.explanation}</span>
                {onSkip && state.phase === 'reveal' && (
                  <button type="button" className="btn small ghost" onClick={onSkip}>
                    Bỏ qua ⏭
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <HpBar player={state.players[me]} label="Bạn" />
    </div>
  );
}
