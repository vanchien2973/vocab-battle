import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_ITEMS, LEVELS, filterItems, type BattleItem, type Level } from '../../data/words';
import { useData } from '../../decks/DataContext';
import { ITEM_TYPE_LABELS, ITEM_TYPES, type Deck, type ItemType } from '../../decks/types';
import { GENERATORS } from '../../game/generators';
import { minSelected } from '../../game/questions';
import { shuffle } from '../../game/rng';
import type { QuestionKind } from '../../game/types';
import { deckItemKey, resolveSelection, type Selection } from '../../storage/selection';
import { WordLink } from '../ai/AppHeader';
import { ItemBadge } from './WordPreview';

interface Props {
  selection: Selection;
  onChange: (sel: Selection) => void;
  /** Called with the resolved items once the selection is valid. */
  onNext: (items: BattleItem[], kinds: QuestionKind[]) => void;
  onBack?: () => void;
  title?: string;
}

type Row = { key: string; item: BattleItem };

/** Step 1: built-in words or items from the player's decks, filters, and which question kinds to ask. */
export function ItemPicker({ selection, onChange, onNext, onBack, title }: Props) {
  const data = useData();
  const [tab, setTab] = useState<'builtin' | 'mine'>(selection.deckIds.length ? 'mine' : 'builtin');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [type, setType] = useState<ItemType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [randomN, setRandomN] = useState(20);
  const [decks, setDecks] = useState<Map<string, Deck>>(new Map());
  const [loadingDecks, setLoadingDecks] = useState(false);
  const selected = useMemo(() => new Set(selection.keys), [selection.keys]);

  // Load the decks opened in "Bộ của tôi" (cached by the data layer).
  useEffect(() => {
    const missing = selection.deckIds.filter((id) => !decks.has(id));
    if (missing.length === 0 || data.summaries === null) return;
    const known = new Set(data.summaries.map((s) => s.id));
    setLoadingDecks(true);
    void Promise.all(missing.filter((id) => known.has(id)).map((id) => data.loadDeck(id).catch(() => null)))
      .then((loaded) => {
        setDecks((m) => {
          const next = new Map(m);
          for (const d of loaded) if (d) next.set(d.id, d);
          return next;
        });
        // Forget decks that no longer exist.
        const gone = missing.filter((id) => !known.has(id));
        if (gone.length) onChange({ ...selection, deckIds: selection.deckIds.filter((id) => !gone.includes(id)), keys: selection.keys.filter((k) => !gone.some((g) => k.startsWith(g + '|'))) });
      })
      .finally(() => setLoadingDecks(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.deckIds, data.summaries]);

  const openDecks = selection.deckIds.map((id) => decks.get(id)).filter((d): d is Deck => !!d);
  const items = useMemo(() => resolveSelection(selection.keys, openDecks), [selection.keys, openDecks]);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === 'builtin') return filterItems(BUILTIN_ITEMS, level, search).map((item) => ({ key: item.id, item }));
    return openDecks.flatMap((d) =>
      d.items
        .filter((it) => it.text.trim() && it.meaning.trim())
        .filter((it) => (type === 'all' || it.type === type) && (!q || it.text.toLowerCase().includes(q) || it.meaning.toLowerCase().includes(q)))
        .map((it) => ({ key: deckItemKey(d.id, it.id), item: { ...it, deckId: d.id } })),
    );
  }, [tab, level, type, search, openDecks]);

  const min = minSelected(items);
  const enough = items.length >= min && selection.kinds.length > 0;
  const setKeys = (keys: string[]) => onChange({ ...selection, keys });
  const toggle = (key: string) => setKeys(selected.has(key) ? selection.keys.filter((k) => k !== key) : [...selection.keys, key]);
  const toggleDeck = (id: string) => {
    const open = selection.deckIds.includes(id);
    onChange({
      ...selection,
      deckIds: open ? selection.deckIds.filter((d) => d !== id) : [...selection.deckIds, id],
      // Opening a deck ticks all its items; closing it drops them.
      keys: open ? selection.keys.filter((k) => !k.startsWith(id + '|')) : selection.keys,
    });
    if (!open) {
      void data.loadDeck(id).then((d) => {
        setDecks((m) => new Map(m).set(d.id, d));
        onChange({
          ...selection,
          deckIds: [...selection.deckIds, id],
          keys: [...new Set([...selection.keys, ...d.items.filter((it) => it.text.trim() && it.meaning.trim()).map((it) => deckItemKey(d.id, it.id))])],
        });
      });
    }
  };
  const toggleKind = (k: QuestionKind) =>
    onChange({ ...selection, kinds: selection.kinds.includes(k) ? selection.kinds.filter((x) => x !== k) : [...selection.kinds, k] });

  const kindsAvailable = useMemo(() => {
    const pool = [...items, ...BUILTIN_ITEMS];
    return new Map(GENERATORS.map((g) => [g.kind, items.filter((it) => g.canGenerate(it, pool)).length]));
  }, [items]);

  return (
    <div className="prepare">
      <header className="prepare-head">
        <div className="steps">
          <span className="step active">1. Chọn từ</span>
          <span className="step">2. Xem trước</span>
        </div>
        {title && <p className="muted">{title}</p>}
        <div className="chips" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'builtin'} className={`chip ${tab === 'builtin' ? 'on' : ''}`} onClick={() => setTab('builtin')}>
            📗 Bộ có sẵn
          </button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={`chip ${tab === 'mine' ? 'on' : ''}`} onClick={() => setTab('mine')}>
            ⭐ Bộ của tôi
          </button>
        </div>

        {tab === 'mine' && (
          <div className="chips deck-chips" role="group" aria-label="Chọn bộ">
            {data.summaries === null && <span className="muted small">Đang tải bộ từ…</span>}
            {data.summaries?.length === 0 && <span className="muted small">Chưa có bộ nào – tạo ở “📚 Bộ từ của tôi”.</span>}
            {data.summaries?.map((d) => (
              <button key={d.id} type="button" aria-pressed={selection.deckIds.includes(d.id)} className={`chip ${selection.deckIds.includes(d.id) ? 'on' : ''}`} onClick={() => toggleDeck(d.id)}>
                {d.name} ({d.itemCount})
              </button>
            ))}
          </div>
        )}

        <div className="filters">
          <div className="chips" role="group" aria-label={tab === 'builtin' ? 'Lọc theo level' : 'Lọc theo loại'}>
            {tab === 'builtin'
              ? (['all', ...LEVELS] as const).map((l) => (
                  <button key={l} type="button" className={`chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                    {l === 'all' ? 'Tất cả' : l}
                  </button>
                ))
              : (['all', ...ITEM_TYPES] as const).map((t) => (
                  <button key={t} type="button" className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
                    {t === 'all' ? 'Mọi loại' : ITEM_TYPE_LABELS[t]}
                  </button>
                ))}
          </div>
          <input type="search" className="input" placeholder="Tìm từ hoặc nghĩa…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="bulk">
          <button type="button" className="btn small" onClick={() => setKeys([...new Set([...selection.keys, ...rows.map((r) => r.key)])])}>
            Chọn tất cả
          </button>
          <button type="button" className="btn small" onClick={() => setKeys(selection.keys.filter((k) => !rows.some((r) => r.key === k)))}>
            Bỏ chọn
          </button>
          <span className="random">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const visible = new Set(rows.map((r) => r.key));
                const n = Math.max(1, Math.min(randomN, rows.length));
                setKeys([...selection.keys.filter((k) => !visible.has(k)), ...shuffle(rows, Math.random).slice(0, n).map((r) => r.key)]);
              }}
            >
              Chọn ngẫu nhiên
            </button>
            <input type="number" className="input tiny" min={1} value={randomN} aria-label="Số mục ngẫu nhiên" onChange={(e) => setRandomN(Math.max(1, Number(e.target.value) || 1))} />
          </span>
        </div>
        <details className="kinds">
          <summary>
            Dạng câu hỏi ({selection.kinds.length}/{GENERATORS.length})
          </summary>
          <div className="chips">
            {GENERATORS.map((g) => (
              <label key={g.kind} className={`chip ${selection.kinds.includes(g.kind) ? 'on' : ''}`}>
                <input type="checkbox" className="sr-only" checked={selection.kinds.includes(g.kind)} onChange={() => toggleKind(g.kind)} />
                {g.label} <span className="small">({kindsAvailable.get(g.kind) ?? 0})</span>
              </label>
            ))}
          </div>
          <p className="muted small">Số trong ngoặc: mục đủ dữ liệu cho dạng đó. Mục không đủ dữ liệu sẽ hỏi Nghĩa hoặc Cloze.</p>
        </details>
      </header>

      <ul className="word-grid">
        {rows.map(({ key, item }) => {
          const on = selected.has(key);
          return (
            <li key={key}>
              <label className={`word-card ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(key)} />
                <span className="word-main">
                  <strong>{item.text}</strong>
                  <span className="muted">{item.meaning}</span>
                </span>
                <ItemBadge item={item} />
                <WordLink word={item.text}>📖</WordLink>
              </label>
            </li>
          );
        })}
        {rows.length === 0 && !loadingDecks && (
          <li className="muted empty">{tab === 'mine' && selection.deckIds.length === 0 ? 'Chọn một hoặc nhiều bộ ở trên.' : 'Không có mục nào.'}</li>
        )}
      </ul>

      <footer className="prepare-foot">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Menu
          </button>
        )}
        <span className={`count ${enough ? '' : 'warn'}`}>
          Đã chọn <strong>{items.length}</strong> mục
          {items.length < min && ` · cần tối thiểu ${min}`}
          {selection.kinds.length === 0 && ' · chọn ít nhất 1 dạng câu hỏi'}
        </span>
        <button type="button" className="btn primary" disabled={!enough} onClick={() => onNext(items, selection.kinds)}>
          Tiếp →
        </button>
      </footer>
    </div>
  );
}
