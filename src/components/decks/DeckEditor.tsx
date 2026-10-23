import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAiClient } from '../../ai';
import { cacheLookup, getCachedLookup } from '../../ai/lookupCache';
import { normalizeWord } from '../../ai/normalize';
import type { GeneratedItem } from '../../ai/tasks';
import { AiError } from '../../ai/types';
import { useData } from '../../decks/DataContext';
import { appendItems, fillDistractors, itemFromEntry, needsDistractors, withIds } from '../../decks/itemTools';
import { ConflictError } from '../../decks/repository';
import {
  DECK_LEVELS,
  duplicateIds,
  emptyItem,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  LIMITS,
  validateDeck,
  validateItem,
  type Deck,
  type DeckLevel,
  type Item,
  type ItemType,
} from '../../decks/types';
import { Sheet } from '../ai/Sheet';
import { SpeakButton } from '../prepare/SpeakButton';
import { ExtractDialog, ImportDialog, ShareDialog } from './DeckDialogs';
import { ItemPreviewDialog } from './ItemPreview';

type SaveStatus = { kind: 'saved' } | { kind: 'saving' } | { kind: 'dirty' } | { kind: 'error'; message: string };
const AUTOSAVE_MS = 800;
const complete = (it: Item) => it.text.trim() !== '' && it.meaning.trim() !== '';

interface Props {
  deckId: string;
  onBack: () => void;
  onStudy: (deckId: string) => void;
}

export function DeckEditor({ deckId, onBack, onStudy }: Props) {
  const data = useData();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'saved' });
  const [conflict, setConflict] = useState<Deck | null>(null);
  const [filter, setFilter] = useState<ItemType | 'all'>('all');
  const [newType, setNewType] = useState<ItemType>('word');
  const [dialog, setDialog] = useState<'import' | 'extract' | 'share' | { suggest: Item; items: GeneratedItem[] } | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editSeq, setEditSeq] = useState(0);
  const deckRef = useRef<Deck | null>(null);
  const saving = useRef(false);
  const again = useRef(false);
  const tried = useRef(new Set<string>());
  deckRef.current = deck;

  useEffect(() => {
    data
      .loadDeck(deckId)
      .then(setDeck)
      .catch((e: Error) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  /** Every user edit goes through here so autosave runs only for real changes. */
  const edit = useCallback((fn: (d: Deck) => Deck) => {
    setDeck((d) => (d ? fn(d) : d));
    setEditSeq((n) => n + 1);
    setStatus({ kind: 'dirty' });
  }, []);

  const save = useCallback(async () => {
    const current = deckRef.current;
    if (!current) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    // Rows still being typed (no text or meaning) stay on screen but are not saved yet.
    const toSend = { ...current, items: current.items.filter(complete) };
    const errors = validateDeck(toSend);
    if (errors.length) {
      setStatus({ kind: 'error', message: errors[0] });
      return;
    }
    saving.current = true;
    setStatus({ kind: 'saving' });
    try {
      const saved = await data.saveDeck(toSend);
      setDeck((d) => (d ? { ...d, _etag: saved._etag, updatedAt: saved.updatedAt } : d));
      setStatus({ kind: 'saved' });
      void addDistractors(saved);
    } catch (e) {
      if (e instanceof ConflictError) setConflict(e.current);
      setStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /** After a save: wrong options for battles, generated once per phrase item in the background. */
  const addDistractors = async (saved: Deck) => {
    const todo = saved.items.filter((it) => needsDistractors(it) && !tried.current.has(it.id));
    if (todo.length === 0) return;
    todo.forEach((it) => tried.current.add(it.id));
    const filled = await fillDistractors(todo, getAiClient());
    const byId = new Map(filled.filter((it) => it.distractors).map((it) => [it.id, it]));
    if (byId.size === 0) return;
    edit((d) => ({
      ...d,
      // Only if the player did not change the phrase meanwhile.
      items: d.items.map((it) => (byId.has(it.id) && byId.get(it.id)!.text === it.text ? { ...it, distractors: byId.get(it.id)!.distractors } : it)),
    }));
  };

  useEffect(() => {
    if (editSeq === 0) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [editSeq, save]);

  // Save pending edits when leaving the editor (autosave timer is cleared on unmount).
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirty = status.kind === 'dirty';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => () => void (dirtyRef.current && saveRef.current()), []);

  const dups = useMemo(() => (deck ? duplicateIds(deck.items) : new Set<string>()), [deck]);
  const counts = useMemo(() => {
    const c: Partial<Record<ItemType, number>> = {};
    for (const it of deck?.items ?? []) c[it.type] = (c[it.type] ?? 0) + 1;
    return c;
  }, [deck]);

  if (loadError) return <p className="error-box">{loadError}</p>;
  if (!deck) return <p className="muted loading">⏳ Đang tải bộ từ…</p>;

  const updateItem = (id: string, patch: Partial<Item>) =>
    edit((d) => ({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...patch, ...(patch.text !== undefined && patch.text !== it.text ? { distractors: undefined } : {}) } : it)) }));
  const move = (id: string, delta: number) =>
    edit((d) => {
      const i = d.items.findIndex((it) => it.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.items.length) return d;
      const items = [...d.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { ...d, items };
    });
  const removeItem = (id: string) => edit((d) => ({ ...d, items: d.items.filter((it) => it.id !== id) }));
  const addItem = () => {
    if (deck.items.length >= LIMITS.maxItemsPerDeck) return;
    const it = emptyItem(newType);
    edit((d) => ({ ...d, items: [it, ...d.items] }));
    if (filter !== 'all' && filter !== newType) setFilter('all');
    setTimeout(() => document.getElementById(`text-${it.id}`)?.focus(), 0);
  };
  const addMany = (items: Item[]) => {
    const r = appendItems(deck.items, items);
    edit((d) => ({ ...d, items: appendItems(d.items, items).items }));
    setNotice(`Đã thêm ${r.added} mục${r.skipped ? `, bỏ qua ${r.skipped} mục trùng hoặc vượt giới hạn` : ''}.`);
  };

  /** "Tự điền": fill empty meaning / examples / IPA from the AI dictionary. */
  const autofill = async (it: Item) => {
    const word = normalizeWord(it.text);
    if (!word) {
      setNotice('Nhập từ/cụm từ tiếng Anh trước (tối đa 40 ký tự).');
      return;
    }
    setBusyItem(it.id);
    try {
      const entry = getCachedLookup(word) ?? (await getAiClient().lookup(word));
      cacheLookup(word, entry);
      const filled = itemFromEntry(entry);
      updateItem(it.id, {
        type: it.type === 'word' && filled.type !== 'word' ? filled.type : it.type,
        meaning: it.meaning.trim() ? it.meaning : filled.meaning,
        examples: it.examples.length ? it.examples : filled.examples,
        ipa: it.ipa || filled.ipa,
        partOfSpeech: it.partOfSpeech || filled.partOfSpeech,
      });
    } catch (e) {
      setNotice(e instanceof AiError ? e.message : 'Không tự điền được.');
    } finally {
      setBusyItem(null);
    }
  };

  const suggest = async (it: Item) => {
    setBusyItem(it.id);
    try {
      setDialog({ suggest: it, items: await getAiClient().suggestPhrases(it.text) });
    } catch (e) {
      setNotice(e instanceof AiError ? e.message : 'Không gợi ý được cụm từ.');
    } finally {
      setBusyItem(null);
    }
  };

  const visible = filter === 'all' ? deck.items : deck.items.filter((it) => it.type === filter);
  const statusText =
    status.kind === 'saved' ? '✓ Đã lưu' : status.kind === 'saving' ? '⏳ Đang lưu…' : status.kind === 'dirty' ? '✎ Chưa lưu' : `⚠️ Lỗi: ${status.message}`;

  return (
    <div className="deck-editor">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Bộ từ
        </button>
        <input
          className="input title-input"
          aria-label="Tên bộ"
          value={deck.name}
          maxLength={LIMITS.fieldLength.deckName}
          onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
        />
        <span className={`save-status ${status.kind}`} aria-live="polite">
          {statusText}
        </span>
      </header>

      <div className="deck-meta-edit">
        <input
          className="input"
          placeholder="Mô tả ngắn"
          value={deck.description}
          maxLength={LIMITS.fieldLength.deckDescription}
          onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))}
        />
        <select className="input" aria-label="Level" value={deck.level} onChange={(e) => edit((d) => ({ ...d, level: e.target.value as DeckLevel }))}>
          {DECK_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'mixed' ? 'Nhiều level' : l}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar">
        <select className="input" aria-label="Loại mục mới" value={newType} onChange={(e) => setNewType(e.target.value as ItemType)}>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" className="btn primary" disabled={deck.items.length >= LIMITS.maxItemsPerDeck} onClick={addItem}>
          + Thêm mục
        </button>
        <button type="button" className="btn" onClick={() => setDialog('import')}>
          📥 Nhập
        </button>
        <button type="button" className="btn" onClick={() => setDialog('extract')}>
          🔎 Trích từ đoạn văn
        </button>
        <button type="button" className="btn" onClick={() => setDialog('share')}>
          🔗 Chia sẻ / Xuất
        </button>
        <button type="button" className="btn" disabled={!deck.items.some(complete)} onClick={() => onStudy(deck.id)}>
          🧠 Học
        </button>
      </div>

      <div className="chips" role="group" aria-label="Lọc theo loại">
        <button type="button" className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          Tất cả ({deck.items.length})
        </button>
        {ITEM_TYPES.map((t) => (
          <button key={t} type="button" className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>
            {ITEM_TYPE_LABELS[t]} ({counts[t] ?? 0})
          </button>
        ))}
      </div>
      {notice && (
        <p className="notice" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}
      {dups.size > 0 && <p className="warn-box">⚠️ Có {dups.size} mục trùng (cùng loại và nội dung) – đánh dấu đỏ bên dưới.</p>}

      <ol className="item-list">
        {visible.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            duplicate={dups.has(it.id)}
            busy={busyItem === it.id}
            onChange={(patch) => updateItem(it.id, patch)}
            onMove={(delta) => move(it.id, delta)}
            onRemove={() => removeItem(it.id)}
            onAutofill={() => void autofill(it)}
            onSuggest={() => void suggest(it)}
          />
        ))}
        {visible.length === 0 && <li className="muted empty">Chưa có mục nào{filter !== 'all' ? ' thuộc loại này' : ''}.</li>}
      </ol>

      {dialog === 'import' && (
        <ImportDialog
          target={deck}
          onClose={() => setDialog(null)}
          onDone={(d) => {
            setDialog(null);
            addMany(d.items.slice(deck.items.length));
          }}
        />
      )}
      {dialog === 'extract' && (
        <ExtractDialog
          onClose={() => setDialog(null)}
          onAdd={(items) => {
            setDialog(null);
            addMany(withIds(items));
          }}
        />
      )}
      {dialog === 'share' && <ShareDialog deck={{ ...deck, items: deck.items.filter(complete) }} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && (
        <ItemPreviewDialog
          title={`💡 Cụm từ với “${dialog.suggest.text}”`}
          items={dialog.items}
          saveLabel="Thêm vào bộ"
          onClose={() => setDialog(null)}
          onSave={(chosen) => {
            setDialog(null);
            addMany(withIds(chosen, dialog.suggest.id));
          }}
        />
      )}
      {conflict && (
        <Sheet title="⚠️ Bộ từ đã được sửa ở nơi khác" onClose={() => setConflict(null)}>
          <div className="sheet-body form-grid">
            <p>
              Bộ này vừa được lưu từ thiết bị hoặc tab khác ({new Date(conflict.updatedAt).toLocaleString('vi-VN')}, {conflict.items.length} mục). Bản đang mở có{' '}
              {deck.items.filter(complete).length} mục. Giữ bản nào?
            </p>
            <div className="actions-row">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  // Keep mine: overwrite using the server's current etag.
                  edit((d) => ({ ...d, _etag: conflict._etag }));
                  setConflict(null);
                }}
              >
                Giữ bản của tôi
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDeck(conflict);
                  setStatus({ kind: 'saved' });
                  setConflict(null);
                }}
              >
                Dùng bản đã lưu kia
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

interface RowProps {
  item: Item;
  duplicate: boolean;
  busy: boolean;
  onChange: (patch: Partial<Item>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onAutofill: () => void;
  onSuggest: () => void;
}

function ItemRow({ item, duplicate, busy, onChange, onMove, onRemove, onAutofill, onSuggest }: RowProps) {
  const [more, setMore] = useState(false);
  const f = LIMITS.fieldLength;
  const errors = item.text || item.meaning ? validateItem(item) : [];
  const setExample = (i: number, patch: Partial<Item['examples'][number]>) => {
    const examples = [...item.examples];
    examples[i] = { ...(examples[i] ?? { en: '', vi: '' }), ...patch };
    onChange({ examples: examples.filter((e, j) => j === i || e.en.trim() || e.vi.trim()) });
  };
  const exampleCount = Math.min(LIMITS.maxExamplesPerItem, more ? item.examples.length + 1 : 1);

  return (
    <li className={`item-row card ${duplicate ? 'dup' : ''}`}>
      <div className="item-line">
        <select className="input type-select" aria-label="Loại" value={item.type} onChange={(e) => onChange({ type: e.target.value as ItemType })}>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          id={`text-${item.id}`}
          className="input"
          placeholder={item.type === 'word' ? 'Từ tiếng Anh' : 'Cụm từ tiếng Anh'}
          value={item.text}
          maxLength={f.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        <input className="input" placeholder="Nghĩa tiếng Việt" value={item.meaning} maxLength={f.meaning} onChange={(e) => onChange({ meaning: e.target.value })} />
        <div className="row-tools">
          {item.text.trim() && <SpeakButton text={item.text} />}
          <button type="button" className="icon-btn" title="Tự điền nghĩa, ví dụ, IPA bằng AI" aria-label="Tự điền" disabled={busy || !item.text.trim()} onClick={onAutofill}>
            {busy ? '⏳' : '🪄'}
          </button>
          {item.type === 'word' && (
            <button type="button" className="icon-btn" title="Gợi ý cụm từ với từ này" aria-label="Gợi ý cụm từ" disabled={busy || !item.text.trim()} onClick={onSuggest}>
              💡
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Lên" onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="icon-btn" aria-label="Xuống" onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="icon-btn" aria-label="Xoá mục" onClick={onRemove}>
            🗑️
          </button>
        </div>
      </div>
      {Array.from({ length: exampleCount }, (_, i) => (
        <div key={i} className="item-line example-line">
          <input className="input" placeholder={`Ví dụ ${i + 1} (tiếng Anh, không bắt buộc)`} value={item.examples[i]?.en ?? ''} maxLength={f.example} onChange={(e) => setExample(i, { en: e.target.value })} />
          <input className="input" placeholder="Dịch (không bắt buộc)" value={item.examples[i]?.vi ?? ''} maxLength={f.example} onChange={(e) => setExample(i, { vi: e.target.value })} />
        </div>
      ))}
      <div className="item-line extra-line">
        <input className="input" placeholder="IPA" value={item.ipa ?? ''} maxLength={f.ipa} onChange={(e) => onChange({ ipa: e.target.value || undefined })} />
        <input className="input" placeholder="Ghi chú" value={item.note ?? ''} maxLength={f.note} onChange={(e) => onChange({ note: e.target.value || undefined })} />
        <button type="button" className="btn small ghost" onClick={() => setMore((m) => !m)}>
          {more ? 'Ít ví dụ hơn' : `+ Ví dụ (${item.examples.length}/${LIMITS.maxExamplesPerItem})`}
        </button>
        {item.distractors && <span className="muted small" title="Đáp án nhiễu cho battle đã sẵn sàng">⚔️ sẵn sàng battle</span>}
      </div>
      {duplicate && <p className="error-text small">Trùng với một mục khác.</p>}
      {errors.length > 0 && <p className="error-text small">{errors.join(' ')}</p>}
    </li>
  );
}
