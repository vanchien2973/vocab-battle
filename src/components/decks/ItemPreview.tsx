import { useState } from 'react';
import type { GeneratedItem } from '../../ai/tasks';
import { ITEM_TYPE_LABELS } from '../../decks/types';
import { Sheet } from '../ai/Sheet';

/** One item as a compact row: type, text, meaning, first example. */
export function ItemSummary({ item }: { item: Pick<GeneratedItem, 'type' | 'text' | 'meaning' | 'examples' | 'ipa'> }) {
  return (
    <span className="item-summary">
      <span className={`badge type-${item.type}`}>{ITEM_TYPE_LABELS[item.type]}</span>
      <strong>{item.text}</strong>
      {item.ipa && <span className="ipa">{item.ipa}</span>}
      <span className="muted">— {item.meaning}</span>
      {item.examples[0] && <span className="example muted small">“{item.examples[0].en}”</span>}
    </span>
  );
}

interface PreviewProps {
  title: string;
  items: GeneratedItem[];
  /** Line errors to show (import). */
  errors?: { line: number; error: string }[];
  saveLabel?: string;
  busy?: boolean;
  onSave: (items: GeneratedItem[]) => void;
  onClose: () => void;
  children?: React.ReactNode;
}

/** "Xem trước": every AI or import result is reviewed (and can be unticked) before saving. */
export function ItemPreviewDialog({ title, items, errors = [], saveLabel = 'Lưu', busy, onSave, onClose, children }: PreviewProps) {
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = items.filter((_, i) => !off.has(i));
  const toggle = (i: number) => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set(s).add(i)));

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sheet-body">
        {children}
        {errors.length > 0 && (
          <div className="warn-box">
            <strong>{errors.length} dòng lỗi (bỏ qua):</strong>
            <ul>
              {errors.slice(0, 20).map((e) => (
                <li key={e.line}>
                  Dòng {e.line}: {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        {items.length > 0 && (
          <div className="bulk">
            <button type="button" className="btn small" onClick={() => setOff(new Set())}>
              Chọn tất cả
            </button>
            <button type="button" className="btn small" onClick={() => setOff(new Set(items.map((_, i) => i)))}>
              Bỏ chọn
            </button>
          </div>
        )}
        <ul className="preview-list">
          {items.map((it, i) => (
            <li key={i}>
              <label className={`word-card ${off.has(i) ? '' : 'on'}`}>
                <input type="checkbox" checked={!off.has(i)} onChange={() => toggle(i)} />
                <ItemSummary item={it} />
              </label>
            </li>
          ))}
          {items.length === 0 && <li className="muted empty">Không có mục nào.</li>}
        </ul>
      </div>
      <footer className="sheet-foot">
        <span className="muted">Đã chọn {chosen.length}/{items.length}</span>
        <button type="button" className="btn primary" disabled={busy || chosen.length === 0} onClick={() => onSave(chosen)}>
          {busy ? 'Đang lưu…' : `${saveLabel} (${chosen.length})`}
        </button>
      </footer>
    </Sheet>
  );
}

export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'bo-tu';
