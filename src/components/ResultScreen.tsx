import type { ReactNode } from 'react';
import type { BattleItem } from '../data/words';
import { ITEM_TYPE_LABELS } from '../decks/types';
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
  /** Items of this match, used to show the wrong ones (online they come from the host). */
  words: readonly BattleItem[];
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

/** Pre-filled chat message asking the tutor about the words and phrases a player got wrong. */
export function wrongWordsPrompt(words: readonly BattleItem[]): string {
  const list = words.map((w) => `- ${w.text}${w.type === 'word' ? '' : ` [${ITEM_TYPE_LABELS[w.type]}]`} (${w.meaning})`).join('\n');
  return `Mình vừa trả lời sai các từ/cụm từ sau trong trận đấu:\n${list}\nHãy giải thích ngắn gọn từng mục (cụm từ thì giải thích cả cụm), cho ví dụ và mẹo ghi nhớ giúp mình.`;
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
        const words = state.players[id].wrongItemIds.map((wid) => byId.get(wid)).filter((w): w is BattleItem => !!w);
        return (
          <section key={id} className="review">
            <h2>{viewers.length > 1 ? `Ôn lại – ${state.players[id].name}` : 'Từ & cụm từ cần ôn lại'}</h2>
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
                      <WordLink word={w.text}>
                        <strong>{w.text}</strong>
                      </WordLink>{' '}
                      – {w.meaning}
                      {w.examples[0] && <div className="example muted">{w.examples[0].en}</div>}
                    </div>
                    <SpeakButton text={w.text} />
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
