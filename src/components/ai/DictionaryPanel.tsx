import { useEffect, useRef, useState } from 'react';
import { getAiClient } from '../../ai';
import { cacheLookup, getCachedLookup } from '../../ai/lookupCache';
import { normalizeWord } from '../../ai/shared';
import type { GeneratedItem } from '../../ai/tasks';
import { AiError, type LookupEntry } from '../../ai/types';
import { itemFromEntry, withIds } from '../../decks/itemTools';
import { ITEM_TYPE_LABELS, type Item } from '../../decks/types';
import { AddToDeckDialog } from '../decks/AddToDeckDialog';
import { ItemPreviewDialog } from '../decks/ItemPreview';
import { SpeakButton } from '../prepare/SpeakButton';
import { useAiUi } from './AiContext';
import { Sheet } from './Sheet';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; entry: LookupEntry; cached: boolean };

export function DictionaryPanel() {
  const { state, close, openDictionary } = useAiUi();
  const { open, word: initial, seq } = state.dictionary;
  const [q, setQ] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const lookup = async (raw: string) => {
    const word = normalizeWord(raw);
    if (!word) {
      setStatus({ kind: 'error', message: 'Nhập một từ hoặc cụm từ tiếng Anh (chỉ chữ cái, tối đa 40 ký tự).' });
      return;
    }
    const cached = getCachedLookup(word);
    if (cached) {
      setStatus({ kind: 'done', entry: cached, cached: true });
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus({ kind: 'loading' });
    try {
      const entry = await lookupCached(word, ctrl.signal);
      if (!ctrl.signal.aborted) setStatus({ kind: 'done', entry, cached: false });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setStatus({ kind: 'error', message: e instanceof AiError ? e.message : 'Tra từ thất bại, thử lại sau.' });
    }
  };

  // Each openDictionary(word) call starts a new lookup.
  useEffect(() => {
    if (!open) return;
    setQ(initial);
    if (initial.trim()) void lookup(initial);
    else setStatus({ kind: 'idle' });
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, open]);

  if (!open) return null;

  return (
    <Sheet title="📖 Từ điển AI" onClose={() => close('dictionary')}>
      <form
        className="lookup-form big"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(q);
        }}
      >
        <input className="input" type="search" autoFocus value={q} maxLength={40} placeholder="Nhập từ tiếng Anh…" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn primary" disabled={status.kind === 'loading'}>
          Tra
        </button>
      </form>
      <div className="sheet-body">
        {status.kind === 'loading' && <p className="muted loading">⏳ Đang tra từ…</p>}
        {status.kind === 'error' && <p className="error-box">{status.message}</p>}
        {status.kind === 'idle' && <p className="muted">Gõ một từ để xem phiên âm, nghĩa, ví dụ, cụm từ hay đi kèm và lỗi người Việt hay mắc.</p>}
        {status.kind === 'done' && <LookupResult entry={status.entry} cached={status.cached} onLookup={openDictionary} />}
      </div>
    </Sheet>
  );
}

/** Cache-first lookup shared by the panel and the "+" buttons. */
async function lookupCached(word: string, signal?: AbortSignal): Promise<LookupEntry> {
  const key = normalizeWord(word) ?? word;
  const cached = getCachedLookup(key);
  if (cached) return cached;
  const entry = await getAiClient().lookup(key, signal);
  cacheLookup(key, entry);
  return entry;
}

type Adding = { items: Item[]; root?: Item } | null;

function LookupResult({ entry, cached, onLookup }: { entry: LookupEntry; cached: boolean; onLookup: (w: string) => void }) {
  const [adding, setAdding] = useState<Adding>(null);
  const [suggested, setSuggested] = useState<GeneratedItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setNote(null);
    setSuggested(null);
  }, [entry.word]);
  const root = () => itemFromEntry(entry);

  /** "+" on a collocation: look it up (so it gets its own meaning and examples), then add it. */
  const addPhrase = async (phrase: string) => {
    setBusy(phrase);
    setNote(null);
    try {
      const e = await lookupCached(phrase);
      const item = itemFromEntry(e);
      if (item.type === 'word' && phrase.trim().includes(' ')) item.type = 'collocation';
      setAdding({ items: [item], root: root() });
    } catch (err) {
      setNote(err instanceof AiError ? err.message : 'Không tra được cụm từ này.');
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy('suggest');
    setNote(null);
    try {
      setSuggested(await getAiClient().suggestPhrases(entry.word));
    } catch (err) {
      setNote(err instanceof AiError ? err.message : 'Không gợi ý được cụm từ.');
    } finally {
      setBusy(null);
    }
  };

  const chips = (title: string, items: string[], clickable = false) =>
    items.length > 0 && (
      <section>
        <h4>{title}</h4>
        <div className="chips">
          {items.map((s) =>
            clickable && normalizeWord(s) ? (
              <button key={s} type="button" className="chip" onClick={() => onLookup(s)}>
                {s}
              </button>
            ) : (
              <span key={s} className="chip static">
                {s}
              </span>
            ),
          )}
        </div>
      </section>
    );

  return (
    <article className="lookup-result">
      <div className="lookup-title">
        <h3>{entry.word}</h3>
        <span className="ipa">{entry.ipa}</span>
        <SpeakButton text={entry.word} />
        <span className={`badge lv-${entry.cefr}`}>{entry.cefr}</span>
        {entry.itemType && entry.itemType !== 'word' && <span className={`badge type-${entry.itemType}`}>{ITEM_TYPE_LABELS[entry.itemType]}</span>}
        {cached && <span className="muted small">(đã lưu)</span>}
      </div>
      <div className="actions-row">
        <button type="button" className="btn primary small" onClick={() => setAdding({ items: [root()] })}>
          ⭐ Thêm vào bộ từ của tôi
        </button>
        {entry.itemType === 'word' && (
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => void suggest()}>
            {busy === 'suggest' ? '⏳ Đang gợi ý…' : '💡 Gợi ý cụm từ'}
          </button>
        )}
      </div>
      {note && <p className="notice">{note}</p>}

      <section>
        <h4>Nghĩa</h4>
        <ol className="senses">
          {entry.senses.map((s, i) => (
            <li key={i}>
              <em className="pos">{s.partOfSpeech}</em> <strong>{s.meaningVi}</strong>
              <div className="muted small">{s.definitionEn}</div>
            </li>
          ))}
        </ol>
      </section>

      {entry.examples.length > 0 && (
        <section>
          <h4>Ví dụ</h4>
          <ul className="examples">
            {entry.examples.map((ex, i) => (
              <li key={i}>
                <div className="example-en">
                  {ex.en} <SpeakButton text={ex.en} />
                </div>
                <div className="muted">{ex.vi}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.collocations.length > 0 && (
        <section>
          <h4>Cụm từ hay đi kèm</h4>
          <div className="chips">
            {entry.collocations.map((c) => (
              <span key={c} className="chip static with-add">
                {c}
                <button type="button" className="chip-add" aria-label={`Thêm "${c}" thành mục riêng`} title="Thêm thành mục riêng" disabled={busy !== null} onClick={() => void addPhrase(c)}>
                  {busy === c ? '…' : '+'}
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      {chips('Đồng nghĩa', entry.synonyms, true)}
      {chips('Trái nghĩa', entry.antonyms, true)}

      {entry.commonMistakes.length > 0 && (
        <section>
          <h4>Lỗi người Việt hay mắc</h4>
          <ul className="mistakes">
            {entry.commonMistakes.map((m, i) => (
              <li key={i}>
                <span className="wrong-text">✗ {m.mistake}</span> → <span className="right-text">✓ {m.correction}</span>
                <div className="muted small">{m.explanationVi}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {suggested && (
        <ItemPreviewDialog
          title={`💡 Cụm từ với “${entry.word}”`}
          items={suggested}
          saveLabel="Thêm vào bộ"
          onClose={() => setSuggested(null)}
          onSave={(chosen) => {
            setSuggested(null);
            setAdding({ items: withIds(chosen), root: root() });
          }}
        />
      )}
      {adding && (
        <AddToDeckDialog
          items={adding.items}
          root={adding.root}
          onClose={() => setAdding(null)}
          onDone={(msg) => {
            setAdding(null);
            setNote(msg);
          }}
        />
      )}
    </article>
  );
}
