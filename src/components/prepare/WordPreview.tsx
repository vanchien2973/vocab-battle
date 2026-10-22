import { useState, type ReactNode } from 'react';
import type { Word } from '../../data/words';
import { SpeakButton } from './SpeakButton';

interface Props {
  words: Word[];
  /** Back to step 1; omitted for the online guest, who cannot edit the set. */
  onBack?: () => void;
  note?: ReactNode;
  /** Ready button(s) and readiness indicators. */
  children: ReactNode;
}

/** Step 2: review the chosen words as flashcards or a quick list. */
export function WordPreview({ words, onBack, note, children }: Props) {
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const word = words[Math.min(index, words.length - 1)];

  const go = (delta: number) => {
    setIndex((i) => (i + delta + words.length) % words.length);
    setFlipped(false);
  };

  return (
    <div className="prepare">
      <header className="prepare-head">
        <div className="steps">
          <span className="step done">1. Chọn từ</span>
          <span className="step active">2. Xem trước</span>
        </div>
        {note}
        <div className="chips" role="tablist">
          <button type="button" role="tab" className={`chip ${view === 'cards' ? 'on' : ''}`} onClick={() => setView('cards')}>
            🃏 Flashcard
          </button>
          <button type="button" role="tab" className={`chip ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>
            ☰ Danh sách ({words.length})
          </button>
        </div>
      </header>

      {view === 'cards' && word && (
        <div className="flash-area">
          <div
            className={`flashcard ${flipped ? 'flipped' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Lật thẻ"
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setFlipped((f) => !f);
              } else if (e.key === 'ArrowRight') go(1);
              else if (e.key === 'ArrowLeft') go(-1);
            }}
          >
            <div className="face front">
              <span className={`badge lv-${word.level}`}>{word.level}</span>
              <h2>{word.word}</h2>
              <SpeakButton text={word.word} />
              <span className="hint">Chạm để lật</span>
            </div>
            <div className="face back">
              <h3>{word.meaning}</h3>
              <p className="example">“{word.example}”</p>
              <SpeakButton text={word.example} />
            </div>
          </div>
          <div className="flash-nav">
            <button type="button" className="btn" onClick={() => go(-1)} aria-label="Từ trước">
              ←
            </button>
            <span>
              {index + 1} / {words.length}
            </span>
            <button type="button" className="btn" onClick={() => go(1)} aria-label="Từ sau">
              →
            </button>
          </div>
        </div>
      )}

      {view === 'list' && (
        <ul className="word-list">
          {words.map((w) => (
            <li key={w.id}>
              <div>
                <strong>{w.word}</strong> <span className={`badge lv-${w.level}`}>{w.level}</span>
                <div>{w.meaning}</div>
                <div className="example muted">{w.example}</div>
              </div>
              <SpeakButton text={w.word} />
            </li>
          ))}
        </ul>
      )}

      <footer className="prepare-foot">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Sửa bộ từ
          </button>
        )}
        <div className="ready-area">{children}</div>
      </footer>
    </div>
  );
}
