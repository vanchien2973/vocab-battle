import type { ReactNode } from 'react';
import type { Word } from '../data/words';
import { matchScore } from '../game/engine';
import type { GameState, PlayerId } from '../game/types';
import { recordMatch, type ScoreMode } from '../storage/highScore';
import { WordLink } from './ai/AppHeader';
import { useAiUi } from './ai/AiContext';
import { SpeakButton } from './prepare/SpeakButton';

interface Props {
  state: GameState;
  mode: ScoreMode;
  /** Players on this device: their scores are saved and their wrong words listed. */
  viewers: PlayerId[];
  /** Words of this match, used to show the wrong ones (online they come from the host). */
  words: readonly Word[];
  children: ReactNode;
}

// Record each finished game once, even if the component renders twice (StrictMode).
const recorded = new WeakMap<GameState, ReturnType<typeof recordMatch>>();

function record(state: GameState, mode: ScoreMode, viewers: PlayerId[]) {
  let r = recorded.get(state);
  if (!r) {
    const score = Math.max(...viewers.map((id) => matchScore(state, id)));
    const combo = Math.max(...viewers.map((id) => state.players[id].maxCombo));
    r = recordMatch(mode, score, combo);
    recorded.set(state, r);
  }
  return r;
}

/** Pre-filled chat message asking the tutor about the words a player got wrong. */
export function wrongWordsPrompt(words: readonly Word[]): string {
  const list = words.map((w) => `- ${w.word} (${w.meaning})`).join('\n');
  return `Mình vừa trả lời sai các từ sau trong trận đấu:\n${list}\nHãy giải thích ngắn gọn từng từ, cho ví dụ và mẹo ghi nhớ giúp mình.`;
}

export function ResultScreen({ state, mode, viewers, words: matchWords, children }: Props) {
  const { openChat } = useAiUi();
  const byId = new Map(matchWords.map((w) => [w.id, w]));
  const records = record(state, mode, viewers);
  const winner = state.winner ? state.players[state.winner] : null;
  const title =
    viewers.length === 1 ? (state.winner === viewers[0] ? '🏆 Bạn thắng!' : '😵 Bạn thua!') : `🏆 ${winner?.name ?? ''} thắng!`;

  return (
    <div className="result">
      <h1>{title}</h1>
      {(records.newScore || records.newCombo) && (
        <p className="record">✨ Kỷ lục mới{records.newScore ? ' · điểm cao nhất' : ''}{records.newCombo ? ' · combo dài nhất' : ''}!</p>
      )}

      <table className="stats">
        <thead>
          <tr>
            <th />
            <th>HP</th>
            <th>Đúng</th>
            <th>Combo max</th>
            <th>Điểm</th>
          </tr>
        </thead>
        <tbody>
          {(['p1', 'p2'] as const).map((id) => (
            <tr key={id} className={state.winner === id ? 'win' : ''}>
              <td>{state.players[id].name}</td>
              <td>{state.players[id].hp}</td>
              <td>{state.players[id].correct}</td>
              <td>{state.players[id].maxCombo}</td>
              <td>{matchScore(state, id)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="actions">{children}</div>

      {viewers.map((id) => {
        const words = state.players[id].wrongWordIds.map((wid) => byId.get(wid)).filter((w): w is Word => !!w);
        return (
          <section key={id} className="review">
            <h2>{viewers.length > 1 ? `Ôn lại – ${state.players[id].name}` : 'Từ cần ôn lại'}</h2>
            {words.length > 0 && (
              <button type="button" className="btn primary small ask-ai" onClick={() => openChat({ mode: 'explain', message: wrongWordsPrompt(words) })}>
                🧑‍🏫 Hỏi AI về các từ {viewers.length > 1 ? `${state.players[id].name} làm sai` : 'tôi làm sai'}
              </button>
            )}
            {words.length === 0 ? (
              <p className="muted">Không sai từ nào. Tuyệt vời! 🎉</p>
            ) : (
              <ul className="word-list">
                {words.map((w) => (
                  <li key={w.id}>
                    <div>
                      <WordLink word={w.word}>
                        <strong>{w.word}</strong>
                      </WordLink>{' '}
                      – {w.meaning}
                      <div className="example muted">{w.example}</div>
                    </div>
                    <SpeakButton text={w.word} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
