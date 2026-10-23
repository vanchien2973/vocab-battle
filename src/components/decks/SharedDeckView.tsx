import { useEffect, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { decodeDeckLink, fetchSharedDeck } from '../../decks/importExport';
import type { Deck } from '../../decks/types';
import { ItemSummary } from './ItemPreview';

export type SharedSource = { kind: 'code'; code: string } | { kind: 'data'; data: string } | { kind: 'deck'; deck: Deck };

/** Opened from ?share=CODE or ?deck=…: preview a shared deck, then "Lưu vào bộ của tôi". */
export function SharedDeckView({ source, onSaved, onClose }: { source: SharedSource; onSaved: (id: string) => void; onClose: () => void }) {
  const data = useData();
  const [deck, setDeck] = useState<Deck | null>(source.kind === 'deck' ? source.deck : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (source.kind === 'code') fetchSharedDeck(source.code).then(setDeck, (e: Error) => setError(e.message));
    else if (source.kind === 'data') {
      const d = decodeDeckLink(source.data);
      if (d) setDeck(d);
      else setError('Link bộ từ bị hỏng hoặc bị cắt mất một phần.');
    }
  }, [source]);

  const save = async () => {
    if (!deck) return;
    setBusy(true);
    try {
      onSaved((await data.importDeck(deck)).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="shared-deck">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onClose}>
          ← Menu
        </button>
        <h1>📦 {deck?.name ?? 'Bộ từ được chia sẻ'}</h1>
      </header>
      {error && <p className="error-box">{error}</p>}
      {!deck && !error && <p className="muted loading">⏳ Đang tải…</p>}
      {deck && (
        <>
          {deck.description && <p className="muted">{deck.description}</p>}
          <p>
            {deck.items.length} mục · level {deck.level === 'mixed' ? 'nhiều level' : deck.level}
          </p>
          <div className="actions-row">
            <button type="button" className="btn primary" disabled={busy || data.authLoading || deck.items.length === 0} onClick={() => void save()}>
              {busy ? '⏳ Đang lưu…' : `⭐ Lưu vào bộ của tôi${data.storage === 'cloud' ? '' : ' (trên máy này)'}`}
            </button>
          </div>
          <ul className="preview-list">
            {deck.items.map((it) => (
              <li key={it.id}>
                <ItemSummary item={it} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
