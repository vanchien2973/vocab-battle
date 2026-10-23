import { useEffect, useMemo, useState } from 'react';
import { LOGIN_PROVIDERS, loginUrl } from '../../auth/auth';
import { useData } from '../../decks/DataContext';
import { DECK_LEVELS, LIMITS, newDeck, newId, type Deck, type DeckSummary } from '../../decks/types';
import { learnedPercent } from '../../study/fsrs';
import { dueCount } from '../../study/queue';
import { AiDeckDialog, ImportDialog, ShareDialog } from './DeckDialogs';

interface Props {
  onOpen: (id: string) => void;
  onStudy: (deckIds: string[] | null) => void;
  onBack: () => void;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** "Bộ từ của tôi": deck cards with search, create (blank / AI / import), duplicate, share, delete. */
export function DecksPage({ onOpen, onStudy, onBack }: Props) {
  const data = useData();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'ai' | 'import' | { share: Deck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decks = data.summaries;
  const atLimit = (decks?.length ?? 0) >= LIMITS.maxDecksPerUser;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (decks ?? []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
  }, [decks, search]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const createBlank = () =>
    run(async () => {
      const names = new Set((decks ?? []).map((d) => d.name));
      let name = 'Bộ từ mới';
      for (let n = 2; names.has(name); n++) name = `Bộ từ mới (${n})`;
      onOpen((await data.createDeck(newDeck(name))).id);
    });

  const duplicate = (s: DeckSummary) =>
    run(async () => {
      const d = await data.loadDeck(s.id);
      await data.importDeck({ ...d, name: `${d.name} (bản sao)`, items: d.items.map((it) => ({ ...it, id: newId() })) });
    });

  const remove = (s: DeckSummary) => {
    if (window.confirm(`Xoá bộ "${s.name}" (${s.itemCount} mục) và tiến độ học của nó? Không thể hoàn tác.`)) void run(() => data.removeDeck(s.id));
  };

  const share = (s: DeckSummary) => run(async () => setDialog({ share: await data.loadDeck(s.id) }));

  return (
    <div className="decks-page">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Menu
        </button>
        <h1>📚 Bộ từ của tôi</h1>
        <span className={`storage-badge ${data.storage}`} title={data.storage === 'cloud' ? 'Lưu trong tài khoản' : 'Chỉ lưu trên máy này'}>
          {data.storage === 'cloud' ? `☁️ ${data.user?.name ?? 'Tài khoản'}` : data.storage === 'local' ? '💾 Trên máy này' : '⚠️ Tạm thời (trình duyệt chặn lưu trữ)'}
        </span>
      </header>

      {!data.user && !data.authLoading && (
        <p className="notice">
          Chưa đăng nhập: bộ từ chỉ lưu trên máy này. Đăng nhập bằng{' '}
          {LOGIN_PROVIDERS.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' hoặc '}
              <a href={loginUrl(p.id)}>{p.label}</a>
            </span>
          ))}{' '}
          để dùng trên mọi thiết bị.
        </p>
      )}

      <div className="toolbar">
        <input className="input" type="search" placeholder="Tìm bộ từ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn primary" disabled={atLimit} onClick={() => void createBlank()}>
          + Bộ mới
        </button>
        <button type="button" className="btn" disabled={atLimit} onClick={() => setDialog('ai')}>
          ✨ Tạo bằng AI
        </button>
        <button type="button" className="btn" disabled={atLimit} onClick={() => setDialog('import')}>
          📥 Nhập
        </button>
        <button type="button" className="btn" disabled={!decks?.length} onClick={() => onStudy(null)}>
          🧠 Ôn hôm nay
        </button>
      </div>
      {atLimit && <p className="muted small">Đã đạt tối đa {LIMITS.maxDecksPerUser} bộ.</p>}
      {(error ?? data.listError) && <p className="error-box">{error ?? data.listError}</p>}
      {decks === null && <p className="muted loading">⏳ Đang tải…</p>}

      <ul className="deck-grid">
        {visible.map((d) => (
          <DeckCard key={d.id} deck={d} onOpen={() => onOpen(d.id)} onStudy={() => onStudy([d.id])} onDuplicate={() => void duplicate(d)} onShare={() => void share(d)} onDelete={() => remove(d)} />
        ))}
        {decks && visible.length === 0 && (
          <li className="muted empty">{decks.length === 0 ? 'Chưa có bộ nào. Tạo bộ mới, nhờ AI tạo, hoặc tra từ rồi bấm “Thêm vào bộ từ”.' : 'Không tìm thấy bộ nào.'}</li>
        )}
      </ul>

      {dialog === 'ai' && <AiDeckDialog onClose={() => setDialog(null)} onCreated={(d) => onOpen(d.id)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={(d) => onOpen(d.id)} />}
      {dialog && typeof dialog === 'object' && <ShareDialog deck={dialog.share} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface CardProps {
  deck: DeckSummary;
  onOpen: () => void;
  onStudy: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function DeckCard({ deck, onOpen, onStudy, onDuplicate, onShare, onDelete }: CardProps) {
  const data = useData();
  const [stats, setStats] = useState<{ learned: number; due: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [full, progress] = await Promise.all([data.loadDeck(deck.id), data.loadProgress(deck.id)]);
        if (alive) setStats({ learned: learnedPercent(full, progress), due: dueCount(full, progress) });
      } catch {
        // stats are optional
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id, deck.updatedAt]);

  const level = DECK_LEVELS.includes(deck.level) ? deck.level : 'mixed';
  return (
    <li className="deck-card card">
      <button type="button" className="deck-main" onClick={onOpen}>
        <span className="deck-title">
          <strong>{deck.name}</strong>
          <span className={`badge lv-${level}`}>{level === 'mixed' ? 'Mix' : level}</span>
        </span>
        {deck.description && <span className="muted small">{deck.description}</span>}
        <span className="deck-meta muted small">
          {deck.itemCount} mục · {stats ? `${stats.learned}% đã thuộc` : '…'}
          {stats && stats.due > 0 && <strong className="due"> · {stats.due} thẻ đến hạn</strong>} · sửa {fmtDate(deck.updatedAt)}
        </span>
        <span className="progress-bar" aria-hidden="true">
          <span style={{ width: `${stats?.learned ?? 0}%` }} />
        </span>
      </button>
      <div className="card-actions">
        <button type="button" className="btn small primary" disabled={deck.itemCount === 0} onClick={onStudy}>
          🧠 Học
        </button>
        <button type="button" className="btn small" onClick={onOpen}>
          ✏️ Sửa
        </button>
        <button type="button" className="btn small" onClick={onDuplicate}>
          ⧉ Nhân bản
        </button>
        <button type="button" className="btn small" onClick={onShare}>
          🔗 Chia sẻ
        </button>
        <button type="button" className="btn small ghost danger" onClick={onDelete}>
          🗑️
        </button>
      </div>
    </li>
  );
}
