import { useState } from 'react';
import { getAiClient } from '../../ai';
import { useData } from '../../decks/DataContext';
import { appendItems, fillDistractors } from '../../decks/itemTools';
import { itemKey, LIMITS, newDeck, type Item } from '../../decks/types';
import { Sheet } from '../ai/Sheet';
import { ItemSummary } from './ItemPreview';

interface Props {
  items: Item[];
  /** Optional root word to add along with a phrase when the deck does not have it yet. */
  root?: Item;
  onDone: (message: string) => void;
  onClose: () => void;
}

/** "Thêm vào bộ từ": pick a deck (or create one) and append the items, skipping duplicates. */
export function AddToDeckDialog({ items, root, onDone, onClose }: Props) {
  const data = useData();
  const [newName, setNewName] = useState('');
  const [withRoot, setWithRoot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decks = data.summaries ?? [];

  const add = async (deckId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const deck = deckId ? await data.loadDeck(deckId) : await data.createDeck(newDeck(newName.trim() || 'Bộ từ mới'));
      let incoming = items;
      if (root) {
        const existingRoot = deck.items.find((it) => itemKey(it) === itemKey(root));
        if (existingRoot) incoming = items.map((it) => ({ ...it, relatedTo: existingRoot.id }));
        else if (withRoot) incoming = [root, ...items.map((it) => ({ ...it, relatedTo: root.id }))];
      }
      incoming = await fillDistractors(incoming, getAiClient());
      const { items: next, added, skipped } = appendItems(deck.items, incoming);
      if (added > 0) await data.saveDeck({ ...deck, items: next });
      onDone(added > 0 ? `Đã thêm ${added} mục vào "${deck.name}"${skipped ? ` (bỏ qua ${skipped} mục trùng)` : ''}.` : `"${deck.name}" đã có sẵn mục này.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="⭐ Thêm vào bộ từ" onClose={onClose}>
      <div className="sheet-body">
        <ul className="preview-list">
          {items.map((it) => (
            <li key={it.id}>
              <ItemSummary item={it} />
            </li>
          ))}
        </ul>
        {root && (
          <label className="check">
            <input type="checkbox" checked={withRoot} onChange={(e) => setWithRoot(e.target.checked)} /> Thêm cả từ gốc “{root.text}” nếu bộ chưa có
          </label>
        )}
        {error && <p className="error-box">{error}</p>}
        <h4>Chọn bộ</h4>
        {data.summaries === null && <p className="muted">Đang tải…</p>}
        <div className="deck-choices">
          {decks.map((d) => (
            <button key={d.id} type="button" className="btn" disabled={busy || d.itemCount >= LIMITS.maxItemsPerDeck} onClick={() => void add(d.id)}>
              {d.name} <span className="muted">({d.itemCount})</span>
            </button>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add(null);
          }}
        >
          <input className="input" placeholder="Hoặc tạo bộ mới…" value={newName} maxLength={LIMITS.fieldLength.deckName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="btn primary" disabled={busy || decks.length >= LIMITS.maxDecksPerUser}>
            + Tạo & thêm
          </button>
        </form>
        {busy && <p className="muted loading">⏳ Đang lưu…</p>}
      </div>
    </Sheet>
  );
}
