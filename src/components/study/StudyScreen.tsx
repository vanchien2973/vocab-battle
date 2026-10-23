import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { ITEM_TYPE_LABELS, type Deck } from '../../decks/types';
import { CARD_TYPES, CARD_TYPE_LABELS, cardKey, Rating, TYPING_PROGRESS_ID, type CardType, type DeckProgress, type TypingSession } from '../../study/fsrs';
import { CONTENT_LABELS } from '../../typing/types';
import { buildQueue, cardTypesFor, computeStats, type StudyCard } from '../../study/queue';
import type { BattleItem } from '../../data/words';
import { loadStudyLimits } from '../../study/settings';
import { useAiUi } from '../ai/AiContext';
import { StudySession, type SessionResult } from './StudySession';

type Mode = 'mix' | CardType;
const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/** "Ôn hôm nay" (all decks) or one deck: stats, choose card type, study, summary. */
interface Props {
  deckIds: string[] | null;
  /** Review exactly these items (e.g. words missed in Luyện Gõ) instead of today's queue. */
  items?: BattleItem[];
  onBack: () => void;
}

export function StudyScreen({ deckIds, items, onBack }: Props) {
  const data = useData();
  const { openSettings } = useAiUi();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [progress, setProgress] = useState<Map<string, DeckProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('mix');
  const [typing, setTyping] = useState(false);
  const [session, setSession] = useState<StudyCard[] | null>(null);
  const [summary, setSummary] = useState<SessionResult[] | null>(null);
  const [reload, setReload] = useState(0);
  const [typingHistory, setTypingHistory] = useState<TypingSession[]>([]);

  useEffect(() => {
    if (data.summaries === null) return;
    let alive = true;
    void (async () => {
      try {
        const ids = items ? [...new Set(items.flatMap((i) => (i.deckId ? [i.deckId] : [])))] : (deckIds ?? data.summaries!.map((s) => s.id));
        if (!items && !deckIds) void data.loadProgress(TYPING_PROGRESS_ID).then((p) => alive && setTypingHistory(p.typing ?? []));
        const loaded = items ? [] : await Promise.all(ids.map((id) => data.loadDeck(id)));
        const prog = await Promise.all(ids.map((id) => data.loadProgress(id)));
        if (!alive) return;
        setDecks(loaded);
        setProgress(new Map(prog.map((p, i) => [ids[i], p])));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckIds, data.summaries, reload]);

  const limits = loadStudyLimits();
  const cardTypes: CardType[] = mode === 'mix' ? [...CARD_TYPES] : [mode];
  const queue = useMemo(
    () =>
      !decks
        ? []
        : items
          ? items.flatMap((item) =>
              cardTypesFor(item, cardTypes).map((cardType) => {
                const key = cardKey(item.sourceId ?? item.id, cardType);
                return { deckId: item.deckId ?? '', item, cardType, key, card: item.deckId ? progress.get(item.deckId)?.cards[key] : undefined };
              }),
            )
          : buildQueue(decks, progress, { limits, cardTypes, shuffle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decks, progress, mode, limits.newPerDay, limits.reviewsPerDay],
  );
  const stats = useMemo(() => (decks ? computeStats(decks, progress) : null), [decks, progress]);

  if (session) {
    return (
      <StudySession
        key={session.map((c) => c.key).join()}
        cards={session}
        typing={typing}
        onFinish={(r) => {
          setSession(null);
          setSummary(r);
        }}
        onQuit={(r) => {
          setSession(null);
          setSummary(r.length ? r : null);
          setReload((n) => n + 1);
        }}
      />
    );
  }

  if (summary) {
    const again = summary.filter((r) => r.grade === Rating.Again);
    const rate = summary.length ? Math.round(((summary.length - again.length) / summary.length) * 100) : 0;
    return (
      <div className="study-summary">
        <h1>🎉 Xong phiên học</h1>
        <div className="stats-row">
          <div className="stat">
            <strong>{summary.length}</strong>
            <span className="muted">thẻ</span>
          </div>
          <div className="stat">
            <strong>{rate}%</strong>
            <span className="muted">nhớ</span>
          </div>
          <div className="stat">
            <strong>{again.length}</strong>
            <span className="muted">Again</span>
          </div>
        </div>
        {again.length > 0 && (
          <>
            <h3>Thẻ cần ôn lại</h3>
            <ul className="preview-list">
              {again.map((r) => (
                <li key={r.card.key}>
                  <strong>{r.card.item.text}</strong> <span className="muted">— {r.card.item.meaning}</span> <span className="badge">{CARD_TYPE_LABELS[r.card.cardType]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="actions-row">
          {again.length > 0 && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setSummary(null);
                setSession(again.map((r) => ({ ...r.card, card: r.after })));
              }}
            >
              🔁 Ôn lại ngay {again.length} thẻ
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSummary(null);
              setReload((n) => n + 1);
            }}
          >
            Tiếp tục
          </button>
          <button type="button" className="btn ghost" onClick={onBack}>
            Thoát
          </button>
        </div>
      </div>
    );
  }

  const title = items ? `Ôn ${items.length} từ vừa gõ sai` : deckIds?.length === 1 ? (decks?.[0]?.name ?? '…') : 'Ôn hôm nay';
  const maxReviews = Math.max(1, ...(stats?.last7.map((d) => d.reviews) ?? [1]));

  return (
    <div className="study-home">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Quay lại
        </button>
        <h1>🧠 {title}</h1>
      </header>
      {error && <p className="error-box">{error}</p>}
      {!decks && !error && <p className="muted loading">⏳ Đang tải…</p>}
      {decks && stats && (
        <>
          <div className="stats-row">
            <div className="stat">
              <strong>{stats.due}</strong>
              <span className="muted">thẻ đến hạn</span>
            </div>
            <div className="stat">
              <strong>🔥 {stats.streak}</strong>
              <span className="muted">ngày liên tiếp</span>
            </div>
            <div className="stat">
              <strong>{queue.length}</strong>
              <span className="muted">thẻ hôm nay</span>
            </div>
          </div>

          <section className="card">
            <h3>7 ngày qua</h3>
            <div className="bar-chart" role="img" aria-label={`Số lượt ôn 7 ngày: ${stats.last7.map((d) => d.reviews).join(', ')}`}>
              {stats.last7.map((d) => (
                <div key={d.day} className="bar-col">
                  <span className="bar-val small">{d.reviews || ''}</span>
                  <span className="bar" style={{ height: `${(d.reviews / maxReviews) * 100}%` }}>
                    <span className="bar-again" style={{ height: d.reviews ? `${(d.again / d.reviews) * 100}%` : 0 }} />
                  </span>
                  <span className="bar-label small muted">{d.day.slice(8)}/{d.day.slice(5, 7)}</span>
                </div>
              ))}
            </div>
            {stats.retentionByType.length > 0 && (
              <ul className="retention">
                {stats.retentionByType.map((r) => (
                  <li key={r.type}>
                    {ITEM_TYPE_LABELS[r.type]}: <strong>{Math.round(r.rate * 100)}%</strong> <span className="muted small">({r.reviews} lượt)</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {typingHistory.length > 0 && <TypingStats sessions={typingHistory} />}

          <section className="card">
            <h3>Kiểu thẻ</h3>
            <div className="chips" role="radiogroup" aria-label="Kiểu thẻ">
              {(['mix', ...CARD_TYPES] as Mode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                  {m === 'mix' ? '🔀 Trộn' : CARD_TYPE_LABELS[m]}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={typing} onChange={(e) => setTyping(e.target.checked)} /> Gõ đáp án (VI → EN, Cloze, Nghe)
            </label>
            <p className="muted small">
              Giới hạn: {limits.newPerDay} thẻ mới, {limits.reviewsPerDay} lượt ôn mỗi ngày ·{' '}
              <button type="button" className="link-btn" onClick={openSettings}>
                đổi trong Cài đặt
              </button>
            </p>
          </section>

          <button type="button" className="btn primary big" disabled={queue.length === 0} onClick={() => setSession(queue)}>
            {queue.length ? `Bắt đầu (${queue.length} thẻ)` : 'Hôm nay đã xong 🎉'}
          </button>
        </>
      )}
    </div>
  );
}

/** "⌨️ Luyện Gõ" card on the stats page: sessions, best WPM, average accuracy, last 5 games. */
function TypingStats({ sessions }: { sessions: TypingSession[] }) {
  const best = Math.max(...sessions.map((s) => s.wpm));
  const avgAcc = sessions.reduce((n, s) => n + s.accuracy, 0) / sessions.length;
  return (
    <section className="card">
      <h3>⌨️ Luyện Gõ</h3>
      <p>
        {sessions.length} phiên · WPM cao nhất <strong>{Math.round(best)}</strong> · chính xác trung bình <strong>{Math.round(avgAcc * 100)}%</strong>
      </p>
      <ul className="retention">
        {sessions
          .slice(-5)
          .reverse()
          .map((s) => (
            <li key={s.at} className="small">
              {new Date(s.at).toLocaleDateString('vi-VN')} · {CONTENT_LABELS[s.content]} · {s.score} điểm · {Math.round(s.wpm)} WPM · {Math.round(s.accuracy * 100)}% · mốc {s.milestone}
            </li>
          ))}
      </ul>
    </section>
  );
}
