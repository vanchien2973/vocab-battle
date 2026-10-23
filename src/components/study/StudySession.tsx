import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { ITEM_TYPE_LABELS } from '../../decks/types';
import { BLANK, makeCloze, sameAnswer } from '../../study/cloze';
import { CARD_TYPE_LABELS, GRADES, Rating, isNew, previewIntervals, review, type Grade, type StoredCard } from '../../study/fsrs';
import type { StudyCard } from '../../study/queue';
import { useAiUi } from '../ai/AiContext';
import { canSpeak, speak } from '../prepare/speech';
import { SpeakButton } from '../prepare/SpeakButton';

const GRADE_LABELS: Record<Grade, string> = { [Rating.Again]: 'Again', [Rating.Hard]: 'Hard', [Rating.Good]: 'Good', [Rating.Easy]: 'Easy' };
const GRADE_VI: Record<Grade, string> = { [Rating.Again]: 'Quên', [Rating.Hard]: 'Khó', [Rating.Good]: 'Nhớ', [Rating.Easy]: 'Dễ' };
const SWIPE_PX = 60;

export interface SessionResult {
  card: StudyCard;
  grade: Grade;
  /** State after the answer, so "Ôn lại ngay" continues from it. */
  after: StoredCard;
}

interface Props {
  cards: StudyCard[];
  /** VI → EN and cloze: type the answer instead of only recalling it. */
  typing: boolean;
  onFinish: (results: SessionResult[]) => void;
  onQuit: (results: SessionResult[]) => void;
}

/** One study session: flip (Space / tap), grade 1–4 or swipe (left Again, right Good). */
export function StudySession({ cards, typing, onFinish, onQuit }: Props) {
  const { queue } = useData();
  const { openChat } = useAiUi();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<SessionResult[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const current = cards[index];
  const cloze = useMemo(() => (current?.cardType === 'cloze' ? makeCloze(current.item) : null), [current]);
  const intervals = useMemo(() => (current ? previewIntervals(current.card) : null), [current]);

  // Listening cards speak the item as soon as they appear.
  useEffect(() => {
    if (current?.cardType === 'listen') speak(current.item.text);
  }, [current]);

  const expected = current?.cardType === 'cloze' ? (cloze?.answer ?? current.item.text) : current?.item.text;
  const typedRight = flipped && typing && typed.trim() !== '' && expected ? sameAnswer(typed, expected) : null;

  const grade = (g: Grade) => {
    if (!current || !flipped) return;
    const after = review(current.card, g);
    // Built-in words (no deck) are practised without saving FSRS progress.
    if (current.deckId) void queue.record(current.deckId, current.key, after, current.item.type, g, isNew(current.card));
    const next = [...results, { card: current, grade: g, after }];
    setResults(next);
    setFlipped(false);
    setTyped('');
    if (index + 1 >= cards.length) {
      void queue.flush();
      onFinish(next);
    } else setIndex(index + 1);
  };

  const flip = () => setFlipped(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === ' ' && !inInput) {
        e.preventDefault();
        if (!flipped) flip();
      } else if (e.key === 'Enter' && inInput && !flipped) {
        e.preventDefault();
        flip();
      } else if (flipped && !inInput && ['1', '2', '3', '4'].includes(e.key)) {
        grade(GRADES[Number(e.key) - 1]);
      } else if (flipped && inInput && ['1', '2', '3', '4'].includes(e.key) && e.altKey) {
        grade(GRADES[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!current) return null;
  const it = current.item;
  const showTyping = typing && (current.cardType === 'vi-en' || current.cardType === 'cloze' || current.cardType === 'listen');

  const front = (() => {
    switch (current.cardType) {
      case 'en-vi':
        return (
          <>
            <h2 className="flash-text">{it.text}</h2>
            {it.ipa && <div className="ipa">{it.ipa}</div>}
            <SpeakButton text={it.text} />
          </>
        );
      case 'vi-en':
        return <h2 className="flash-text">{it.meaning}</h2>;
      case 'cloze':
        return (
          <>
            <p className="cloze-sentence">{cloze?.sentence ?? BLANK}</p>
            {cloze?.example.vi && <p className="muted">{cloze.example.vi}</p>}
            <p className="muted small">Gợi ý: {it.meaning}</p>
          </>
        );
      case 'listen':
        return (
          <>
            <button type="button" className="btn big" onClick={(e) => (e.stopPropagation(), speak(it.text))}>
              🔊 Nghe lại
            </button>
            {!canSpeak() && <p className="muted small">Trình duyệt không hỗ trợ đọc. Từ cần đoán: nghĩa “{it.meaning}”.</p>}
          </>
        );
    }
  })();

  const askAi = () =>
    openChat({
      mode: 'explain',
      message:
        `Giải thích giúp mình ${ITEM_TYPE_LABELS[it.type].toLowerCase()} "${it.text}" (nghĩa: ${it.meaning}).` +
        (it.examples[0] ? ` Ví dụ: "${it.examples[0].en}".` : '') +
        ' Cho thêm 2 ví dụ và mẹo nhớ.',
    });

  return (
    <div className="study-session">
      <header className="study-head">
        <button type="button" className="btn ghost small" onClick={() => (void queue.flush(), onQuit(results))}>
          ✕ Dừng
        </button>
        <span className="muted">
          {index + 1}/{cards.length} · {CARD_TYPE_LABELS[current.cardType]} · {isNew(current.card) ? 'Mới' : 'Ôn'}
        </span>
        <button type="button" className="btn ghost small" onClick={askAi} title="Hỏi AI về thẻ này">
          🧑‍🏫 Hỏi AI
        </button>
      </header>
      <div className="study-progress" aria-hidden="true">
        <span style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>

      <div
        className={`study-card ${flipped ? 'flipped' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Mặt sau' : 'Chạm để lật thẻ'}
        onClick={() => !flipped && !showTyping && flip()}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start || !flipped) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) grade(dx < 0 ? Rating.Again : Rating.Good);
        }}
      >
        <div className="study-inner">
          <div className="study-face front">
            <span className={`badge type-${it.type}`}>{ITEM_TYPE_LABELS[it.type]}</span>
            {front}
            {showTyping && !flipped && (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  flip();
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input className="input" autoFocus value={typed} placeholder="Gõ đáp án…" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
                <button type="submit" className="btn primary">
                  Kiểm tra
                </button>
              </form>
            )}
            {!flipped && <p className="muted small hint">{showTyping ? 'Enter để kiểm tra' : 'Space hoặc chạm để lật'}</p>}
          </div>
          {flipped && (
            <div className="study-face back">
              {typedRight !== null && <p className={typedRight ? 'right-text' : 'wrong-text'}>{typedRight ? '✓ Chính xác!' : `✗ Bạn gõ: ${typed}`}</p>}
              <h2 className="flash-text">
                {it.text} <SpeakButton text={it.text} />
              </h2>
              {it.ipa && <div className="ipa">{it.ipa}</div>}
              <p className="flash-meaning">{it.meaning}</p>
              {it.examples.slice(0, 2).map((ex, i) => (
                <p key={i} className="example">
                  “{ex.en}” <SpeakButton text={ex.en} />
                  {ex.vi && <span className="muted small"> — {ex.vi}</span>}
                </p>
              ))}
              {it.note && <p className="muted small">📝 {it.note}</p>}
            </div>
          )}
        </div>
      </div>

      {flipped ? (
        <div className="grade-buttons">
          {GRADES.map((g, i) => (
            <button key={g} type="button" className={`btn grade-${GRADE_LABELS[g].toLowerCase()} ${typedRight === false && g === Rating.Again ? 'suggest' : ''} ${typedRight && g === Rating.Good ? 'suggest' : ''}`} onClick={() => grade(g)}>
              <kbd>{i + 1}</kbd> {GRADE_LABELS[g]}
              <span className="small">{GRADE_VI[g]} · {intervals?.[g]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grade-buttons">
          <button type="button" className="btn primary big" onClick={flip}>
            Lật thẻ <kbd>Space</kbd>
          </button>
        </div>
      )}
      <p className="muted small center">Phím 1–4 để chấm · Điện thoại: vuốt trái = Again, vuốt phải = Good</p>
    </div>
  );
}
