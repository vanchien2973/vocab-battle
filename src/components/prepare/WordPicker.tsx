import { useMemo, useState } from 'react';
import { ALL_WORDS, LEVELS, filterWords, type Level } from '../../data/words';
import { MIN_SELECTED_WORDS } from '../../game/questions';
import { shuffle } from '../../game/rng';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
  onNext: () => void;
  onBack?: () => void;
  title?: string;
}

/** Step 1: choose the words the match will ask. */
export function WordPicker({ selected, onChange, onNext, onBack, title }: Props) {
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [search, setSearch] = useState('');
  const [randomN, setRandomN] = useState(20);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => filterWords(ALL_WORDS, level, search), [level, search]);
  const enough = selected.length >= MIN_SELECTED_WORDS;

  const toggle = (id: string) =>
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectAllVisible = () => onChange([...new Set([...selected, ...visible.map((w) => w.id)])]);
  const pickRandom = () => {
    const n = Math.max(1, Math.min(randomN, visible.length));
    onChange(shuffle(visible, Math.random).slice(0, n).map((w) => w.id));
  };

  return (
    <div className="prepare">
      <header className="prepare-head">
        <div className="steps">
          <span className="step active">1. Chọn từ</span>
          <span className="step">2. Xem trước</span>
        </div>
        {title && <p className="muted">{title}</p>}
        <div className="filters">
          <div className="chips" role="group" aria-label="Lọc theo level">
            {(['all', ...LEVELS] as const).map((l) => (
              <button key={l} type="button" className={`chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                {l === 'all' ? 'Tất cả' : l}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="input"
            placeholder="Tìm từ hoặc nghĩa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="bulk">
          <button type="button" className="btn small" onClick={selectAllVisible}>
            Chọn tất cả
          </button>
          <button type="button" className="btn small" onClick={() => onChange([])}>
            Bỏ chọn
          </button>
          <span className="random">
            <button type="button" className="btn small" onClick={pickRandom}>
              Chọn ngẫu nhiên
            </button>
            <input
              type="number"
              className="input tiny"
              min={1}
              max={ALL_WORDS.length}
              value={randomN}
              aria-label="Số từ ngẫu nhiên"
              onChange={(e) => setRandomN(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="muted">từ</span>
          </span>
        </div>
      </header>

      <ul className="word-grid">
        {visible.map((w) => {
          const on = selectedSet.has(w.id);
          return (
            <li key={w.id}>
              <label className={`word-card ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(w.id)} />
                <span className="word-main">
                  <strong>{w.word}</strong>
                  <span className="muted">{w.meaning}</span>
                </span>
                <span className={`badge lv-${w.level}`}>{w.level}</span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && <li className="muted empty">Không tìm thấy từ nào.</li>}
      </ul>

      <footer className="prepare-foot">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Menu
          </button>
        )}
        <span className={`count ${enough ? '' : 'warn'}`}>
          Đã chọn <strong>{selected.length}</strong> từ{!enough && ` · cần tối thiểu ${MIN_SELECTED_WORDS}`}
        </span>
        <button type="button" className="btn primary" disabled={!enough} onClick={onNext}>
          Tiếp →
        </button>
      </footer>
    </div>
  );
}
