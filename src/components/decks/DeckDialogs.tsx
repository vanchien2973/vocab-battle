import { useState } from 'react';
import { getAiClient } from '../../ai';
import type { GeneratedItem } from '../../ai/tasks';
import { AiError, CEFR_LEVELS, type Cefr } from '../../ai/types';
import { useData } from '../../decks/DataContext';
import {
  createShareCode,
  deckLink,
  exportCsv,
  exportJson,
  importJson,
  isLinkTooLong,
  parseImport,
  shareCodeLink,
} from '../../decks/importExport';
import { fillDistractors, withIds } from '../../decks/itemTools';
import { LIMITS, newDeck, type Deck } from '../../decks/types';
import { Sheet } from '../ai/Sheet';
import { download, fileSafe, ItemPreviewDialog } from './ItemPreview';

const aiMessage = (e: unknown, fallback: string) => (e instanceof AiError ? e.message : (e as Error)?.message || fallback);

/** Save a new deck, then add battle distractors for its phrases in the background. */
export function useCreateWithDistractors() {
  const data = useData();
  return async (deck: Deck) => {
    const saved = await data.createDeck(deck);
    void fillDistractors(saved.items, getAiClient()).then((items) => {
      if (items.some((it, i) => it !== saved.items[i])) void data.saveDeck({ ...saved, items }).catch(() => undefined);
    });
    return saved;
  };
}

// ---------- "Tạo bộ bằng AI" ----------

export function AiDeckDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (deck: Deck) => void }) {
  const create = useCreateWithDistractors();
  const g = LIMITS.generateDeck;
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<Cefr>('B1');
  const [count, setCount] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; description: string; items: GeneratedItem[] } | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await getAiClient().generateDeck({ topic, level, count }));
    } catch (e) {
      setError(aiMessage(e, 'Tạo bộ thất bại.'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <ItemPreviewDialog
        title="✨ Xem trước bộ từ AI tạo"
        items={result.items}
        saveLabel="Lưu bộ"
        busy={busy}
        onClose={onClose}
        onSave={async (chosen) => {
          setBusy(true);
          try {
            onCreated(await create(newDeck(result.name, { description: result.description, level, items: withIds(chosen) })));
          } catch (e) {
            setError(aiMessage(e, 'Lưu thất bại.'));
            setBusy(false);
          }
        }}
      >
        <label>
          Tên bộ
          <input className="input" value={result.name} maxLength={LIMITS.fieldLength.deckName} onChange={(e) => setResult({ ...result, name: e.target.value })} />
        </label>
        {error && <p className="error-box">{error}</p>}
      </ItemPreviewDialog>
    );
  }

  return (
    <Sheet title="✨ Tạo bộ bằng AI" onClose={onClose}>
      <form
        className="sheet-body form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <label>
          Chủ đề
          <input className="input" autoFocus required value={topic} maxLength={g.maxTopicLength} placeholder="vd: du lịch sân bay, phỏng vấn xin việc…" onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label>
          Level
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value as Cefr)}>
            {CEFR_LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Số mục ({g.minCount}–{g.maxCount})
          <input className="input" type="number" min={g.minCount} max={g.maxCount} value={count} onChange={(e) => setCount(Math.min(g.maxCount, Math.max(g.minCount, Number(e.target.value) || g.minCount)))} />
        </label>
        {error && <p className="error-box">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy || !topic.trim()}>
          {busy ? '⏳ AI đang tạo…' : 'Tạo'}
        </button>
        <p className="muted small">Bạn sẽ xem trước và bỏ chọn mục không cần trước khi lưu.</p>
      </form>
    </Sheet>
  );
}

// ---------- Import ----------

type ImportMode = 'lines' | 'csv' | 'json';

/** Paste "word - nghĩa" lines, or upload CSV / JSON; preview with line errors, then save. */
export function ImportDialog({ target, onClose, onDone }: { target?: Deck; onClose: () => void; onDone: (deck: Deck) => void }) {
  const create = useCreateWithDistractors();
  const data = useData();
  const [mode, setMode] = useState<ImportMode>('lines');
  const [text, setText] = useState('');
  const [name, setName] = useState('Bộ nhập');
  const [preview, setPreview] = useState<{ items: GeneratedItem[]; errors: { line: number; error: string }[]; deck?: Deck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readFile = (file: File) => {
    if (file.size > 2_000_000) {
      setError('Tệp quá lớn (tối đa 2 MB).');
      return;
    }
    void file.text().then((t) => {
      setText(t);
      setName(file.name.replace(/\.(csv|json|txt)$/i, '').slice(0, LIMITS.fieldLength.deckName) || name);
    });
  };

  const parse = () => {
    setError(null);
    try {
      if (mode === 'json') {
        const deck = importJson(text);
        setPreview({ items: deck.items, errors: [], deck });
        return;
      }
      const lines = parseImport(text, mode);
      setPreview({
        items: lines.filter((l) => l.item).map((l) => l.item!),
        errors: lines.filter((l) => l.error).map((l) => ({ line: l.line, error: l.error! })),
      });
    } catch (e) {
      setError((e as Error).message || 'Không đọc được dữ liệu.');
    }
  };

  if (preview) {
    return (
      <ItemPreviewDialog
        title="📥 Xem trước khi nhập"
        items={preview.items}
        errors={preview.errors}
        saveLabel={target ? `Thêm vào "${target.name}"` : 'Tạo bộ'}
        busy={busy}
        onClose={onClose}
        onSave={async (chosen) => {
          setBusy(true);
          try {
            const items = withIds(chosen);
            if (target) onDone({ ...target, items: [...target.items, ...items].slice(0, LIMITS.maxItemsPerDeck) });
            else onDone(await create(newDeck(preview.deck?.name ?? name, { description: preview.deck?.description ?? '', level: preview.deck?.level ?? 'mixed', items })));
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {error && <p className="error-box">{error}</p>}
      </ItemPreviewDialog>
    );
  }

  return (
    <Sheet title="📥 Nhập từ vựng" onClose={onClose}>
      <div className="sheet-body form-grid">
        <div className="chips" role="tablist">
          {(
            [
              ['lines', 'Dán "từ - nghĩa"'],
              ['csv', 'CSV'],
              ['json', 'JSON'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'lines' ? (
          <p className="muted small">Mỗi dòng một mục, vd: <code>resilient - kiên cường</code>. Cụm nhiều từ sẽ được đánh dấu là collocation (đổi lại được sau).</p>
        ) : mode === 'csv' ? (
          <p className="muted small">Cột: <code>word,meaning,example</code> (dòng tiêu đề có thể bỏ qua).</p>
        ) : (
          <p className="muted small">Tệp JSON xuất từ Vocab Battle.</p>
        )}
        {mode !== 'lines' && <input type="file" accept={mode === 'csv' ? '.csv,text/csv' : '.json,application/json'} onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />}
        <textarea className="input" rows={8} value={text} placeholder={mode === 'lines' ? 'apple - quả táo\nlook into - điều tra' : ''} onChange={(e) => setText(e.target.value)} />
        {!target && mode !== 'json' && (
          <label>
            Tên bộ mới
            <input className="input" value={name} maxLength={LIMITS.fieldLength.deckName} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {error && <p className="error-box">{error}</p>}
        <button type="button" className="btn primary" disabled={!text.trim() || data.summaries === null} onClick={parse}>
          Xem trước →
        </button>
      </div>
    </Sheet>
  );
}

// ---------- AI extract from a passage ----------

export function ExtractDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (items: GeneratedItem[]) => void }) {
  const [passage, setPassage] = useState('');
  const [level, setLevel] = useState<Cefr>('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<GeneratedItem[] | null>(null);
  const max = LIMITS.extractItems.maxPassageLength;

  if (items) return <ItemPreviewDialog title="🔎 Từ & cụm từ trong đoạn văn" items={items} saveLabel="Thêm vào bộ" onClose={onClose} onSave={onAdd} />;

  return (
    <Sheet title="🔎 Trích cụm từ từ đoạn văn" onClose={onClose}>
      <div className="sheet-body form-grid">
        <textarea className="input" rows={10} value={passage} maxLength={max} placeholder="Dán một đoạn tiếng Anh (bài báo, email, lời bài hát…)" onChange={(e) => setPassage(e.target.value)} />
        <span className="muted small">
          {passage.length}/{max} ký tự
        </span>
        <label>
          Level của bạn
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value as Cefr)}>
            {CEFR_LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        {error && <p className="error-box">{error}</p>}
        <button
          type="button"
          className="btn primary"
          disabled={busy || !passage.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setItems(await getAiClient().extractItems(passage, level));
            } catch (e) {
              setError(aiMessage(e, 'Trích xuất thất bại.'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '⏳ AI đang đọc…' : 'Tìm từ & cụm từ'}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- Share & export ----------

export function ShareDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const data = useData();
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (data.user) {
        const { code, expiresAt } = await createShareCode(deck.id);
        setLink(shareCodeLink(code));
        setNote(`Mã ${code} dùng được đến ${new Date(expiresAt).toLocaleDateString('vi-VN')}.`);
      } else {
        const url = deckLink(deck);
        setLink(url);
        if (isLinkTooLong(url))
          setNote(`Link dài ${url.length} ký tự (quá ${LIMITS.deckLinkWarnLength}) – có thể bị cắt khi gửi qua chat. Đăng nhập để có link ngắn, hoặc gửi tệp JSON.`);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNote((n) => `${n ? n + ' ' : ''}Đã sao chép.`);
    } catch {
      setNote('Không sao chép được, hãy chọn link và copy thủ công.');
    }
  };

  return (
    <Sheet title={`🔗 Chia sẻ "${deck.name}"`} onClose={onClose}>
      <div className="sheet-body form-grid">
        <p className="muted small">
          {data.user ? 'Tạo mã 8 ký tự (hiệu lực 30 ngày). Ai có link đều xem và lưu được bộ này.' : 'Chưa đăng nhập: toàn bộ từ được nén vào link.'}
        </p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void make()}>
          {busy ? '⏳ Đang tạo…' : link ? 'Tạo lại link' : 'Tạo link chia sẻ'}
        </button>
        {link && (
          <div className="inline-form">
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => void copy()}>
              📋 Copy
            </button>
          </div>
        )}
        {note && <p className="notice">{note}</p>}
        <h4>Xuất tệp</h4>
        <div className="actions-row">
          <button type="button" className="btn small" onClick={() => download(`${fileSafe(deck.name)}.json`, exportJson(deck), 'application/json')}>
            ⬇️ JSON
          </button>
          <button type="button" className="btn small" onClick={() => download(`${fileSafe(deck.name)}.csv`, '﻿' + exportCsv(deck), 'text/csv;charset=utf-8')}>
            ⬇️ CSV
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- First sign-in sync ----------

export function SyncPrompt() {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  if (data.syncOffer === null) return null;

  return (
    <Sheet title="☁️ Đồng bộ bộ từ" onClose={data.declineSync}>
      <div className="sheet-body form-grid">
        {result ? (
          <>
            <p>{result}</p>
            <button type="button" className="btn primary" onClick={data.declineSync}>
              OK
            </button>
          </>
        ) : (
          <>
            <p>
              Máy này có <strong>{data.syncOffer}</strong> bộ từ tạo khi chưa đăng nhập. Chuyển chúng (kèm tiến độ học) vào tài khoản để dùng trên mọi thiết bị?
            </p>
            <p className="muted small">Bộ trùng tên sẽ được giữ cả hai, bộ mới thêm hậu tố “(2)”.</p>
            <div className="actions-row">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await data.acceptSync();
                  setResult(
                    `Đã chuyển ${r.copied} bộ${r.renamed ? ` (${r.renamed} bộ được đổi tên)` : ''}.` +
                      (r.failed.length ? ` Chưa chuyển được: ${r.failed.join(', ')} – vẫn còn trên máy này.` : ''),
                  );
                  setBusy(false);
                }}
              >
                {busy ? '⏳ Đang đồng bộ…' : 'Đồng bộ'}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={data.declineSync}>
                Để sau
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
