import { useState, type ReactNode } from 'react';
import type { BattleItem } from '../../data/words';
import { ITEM_TYPE_LABELS } from '../../decks/types';
import { WordLink } from '../ai/AppHeader';
import { SpeakButton } from './SpeakButton';

interface Props {
  words: BattleItem[];
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
              <ItemBadge item={word} />
              <h2>{word.text}</h2>
              <span className="card-tools">
                <SpeakButton text={word.text} />
                <WordLink word={word.text}>📖</WordLink>
              </span>
              <span className="hint">Chạm để lật</span>
            </div>
            <div className="face back">
              <h3>{word.meaning}</h3>
              {word.examples[0] && (
                <>
                  <p className="example">“{word.examples[0].en}”</p>
                  <SpeakButton text={word.examples[0].en} />
                </>
              )}
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
                <WordLink word={w.text}>
                  <strong>{w.text}</strong>
                </WordLink>{' '}
                <ItemBadge item={w} />
                <div>{w.meaning}</div>
                {w.examples[0] && <div className="example muted">{w.examples[0].en}</div>}
              </div>
              <SpeakButton text={w.text} />
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

/** Level for built-in words, item type for phrases from decks. */
export function ItemBadge({ item }: { item: BattleItem }) {
  if (item.type !== 'word' || !item.level) return <span className={`badge type-${item.type}`}>{ITEM_TYPE_LABELS[item.type]}</span>;
  return <span className={`badge lv-${item.level}`}>{item.level}</span>;
}
