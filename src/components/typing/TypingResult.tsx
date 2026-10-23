import type { ReactNode } from 'react';
import { ITEM_TYPE_LABELS } from '../../decks/types';
import type { BattleItem } from '../../data/words';
import { CONTENT_LABELS } from '../../typing/types';
import { useAiUi } from '../ai/AiContext';
import { wrongWordsPrompt } from '../ResultScreen';
import { SpeakButton } from '../prepare/SpeakButton';
import type { TypingResultData } from './TypingPlay';

const TITLES: Record<TypingResultData['result'], string> = {
  win: '🏆 Bạn thắng!',
  lose: '😵 Bạn thua!',
  cleared: '🎉 Hoàn thành 20 mốc!',
  dead: '💥 Hết tim!',
  quit: '⏹ Đã dừng',
};

interface Props {
  data: TypingResultData;
  best?: { score: number; isNew: boolean } | null;
  onReview?: (items: BattleItem[]) => void;
  children: ReactNode;
}

/** Score, milestone, WPM, accuracy, best combo, and the words to review. */
export function TypingResult({ data, best, onReview, children }: Props) {
  const { openChat } = useAiUi();
  const review = data.outcomes.filter((o) => o.outcome !== 'clean');
  const items = review.map((o) => o.item);

  return (
    <div className="result typing-result">
      <h1>{TITLES[data.result]}</h1>
      {data.reason && <p className="muted">{data.reason}</p>}
      {best?.isNew && <p className="record">✨ Kỷ lục mới cho bộ này!</p>}
      <div className="stats-row five">
        <div className="stat">
          <strong>{data.score}</strong>
          <span className="muted">điểm{best && !best.isNew ? ` · kỷ lục ${best.score}` : ''}</span>
        </div>
        <div className="stat">
          <strong>{data.milestone}</strong>
          <span className="muted">mốc</span>
        </div>
        <div className="stat">
          <strong>{Math.round(data.wpm)}</strong>
          <span className="muted">WPM</span>
        </div>
        <div className="stat">
          <strong>{Math.round(data.accuracy * 100)}%</strong>
          <span className="muted">chính xác</span>
        </div>
        <div className="stat">
          <strong>{data.maxCombo}</strong>
          <span className="muted">combo max</span>
        </div>
      </div>
      <p className="muted small">Kiểu: {CONTENT_LABELS[data.content]}</p>

      <div className="actions">{children}</div>

      <section className="review">
        <h2>Từ cần ôn lại ({review.length})</h2>
        {review.length > 0 && (
          <div className="actions-row">
            {onReview && (
              <button type="button" className="btn primary small" onClick={() => onReview(items)}>
                🧠 Ôn các từ này bằng flashcard
              </button>
            )}
            <button type="button" className="btn small" onClick={() => openChat({ mode: 'explain', message: wrongWordsPrompt(items) })}>
              🧑‍🏫 Hỏi AI về các từ này
            </button>
          </div>
        )}
        {review.length === 0 ? (
          <p className="muted">Không sai, không để lọt từ nào. Tuyệt vời! 🎉</p>
        ) : (
          <ul className="word-list">
            {review.map(({ item, outcome }) => (
              <li key={item.id}>
                <div>
                  <strong>{item.text}</strong> – {item.meaning}{' '}
                  <span className={`badge ${outcome === 'missed' ? 'miss' : 'assist'}`}>{outcome === 'missed' ? 'để lọt' : 'gõ sai/gợi ý'}</span>
                  {item.type !== 'word' && <span className={`badge type-${item.type}`}>{ITEM_TYPE_LABELS[item.type]}</span>}
                </div>
                <SpeakButton text={item.text} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
