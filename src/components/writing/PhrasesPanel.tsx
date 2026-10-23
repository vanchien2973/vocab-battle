import { useState } from 'react';
import { ITEM_TYPE_LABELS, type Item } from '../../decks/types';
import { phraseDeckName, phrasesToItems } from '../../vstep/phrases';
import type { UsefulPhrase } from '../../vstep/types';
import { AddToDeckDialog } from '../decks/AddToDeckDialog';
import { SpeakButton } from '../prepare/SpeakButton';

/** Useful phrases from the rewrite: tick the ones to keep and add them to a deck as items. */
export function PhrasesPanel({ phrases, topic }: { phrases: UsefulPhrase[]; topic: string }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(phrases.map((_, i) => i)));
  const [adding, setAdding] = useState<Item[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (phrases.length === 0) return <p className="muted">Chưa có cụm từ gợi ý cho bài này.</p>;
  const chosen = phrases.filter((_, i) => picked.has(i));

  return (
    <div className="phrases">
      <ul className="phrase-list">
        {phrases.map((p, i) => (
          <li key={p.text}>
            <label className="check">
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={(e) =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span>
                <strong lang="en">{p.text}</strong> <span className="badge">{ITEM_TYPE_LABELS[p.type]}</span> <span className="muted">— {p.meaningVi}</span>
                {p.example && (
                  <span className="small muted phrase-example" lang="en">
                    {p.example}
                  </span>
                )}
              </span>
            </label>
            <SpeakButton text={p.text} />
          </li>
        ))}
      </ul>
      <div className="actions-row">
        <button type="button" className="btn primary" disabled={chosen.length === 0} onClick={() => setAdding(phrasesToItems(chosen, topic))}>
          ⭐ Thêm {chosen.length} cụm vào bộ từ
        </button>
      </div>
      {done && (
        <p className="notice small" role="status">
          {done} Học chúng bằng flashcard, battle hoặc Luyện Gõ.
        </p>
      )}
      {adding && (
        <AddToDeckDialog
          items={adding}
          defaultNewName={phraseDeckName(topic)}
          onDone={(msg) => {
            setDone(msg);
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
