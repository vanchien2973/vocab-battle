import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { CATEGORY_LABELS, ERROR_CATEGORIES, RULE_LABELS, TOPIC_LABELS, type TaskNo } from '../../vstep/config';
import type { WritingHistory as History } from '../../vstep/repository';
import { bandLabel } from '../../vstep/scoring';
import { topCounts } from '../../vstep/stats';
import type { WritingSummary } from '../../vstep/types';
import { CATEGORY_TAGS } from './AnnotatedEssay';
import { HistoryChart } from './HistoryChart';

interface Props {
  onBack: () => void;
  /** Open a past attempt (with the other task of the same test, if any). */
  onOpen: (summary: WritingSummary, all: WritingSummary[]) => void;
}

const minutes = (sec: number) => (sec ? `${Math.max(1, Math.round(sec / 60))} phút` : '–');

/** Graded essays: filters, progress chart per criterion and the most common mistakes. */
export function WritingHistory({ onBack, onOpen }: Props) {
  const data = useData();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskNo | 0>(0);
  const [topic, setTopic] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    data.writings
      .history()
      .then((h) => alive && setHistory(h))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [data.writings, reload]);

  const rows = useMemo(
    () => (history?.summaries ?? []).filter((s) => (!task || s.task === task) && (!topic || s.topic === topic)),
    [history, task, topic],
  );
  const chronological = useMemo(() => [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-30), [rows]);
  const topics = [...new Set((history?.summaries ?? []).map((s) => s.topic))];
  const stats = history?.stats;
  const maxCat = Math.max(1, ...ERROR_CATEGORIES.map((c) => stats?.categories[c] ?? 0));

  const remove = async (s: WritingSummary) => {
    if (!window.confirm(`Xoá bài “${s.title}” (lần ${s.attempt})?`)) return;
    try {
      await data.writings.remove(s.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="writing-history">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Quay lại
        </button>
        <h1>📈 Lịch sử Writing</h1>
      </header>
      <p className="muted small">{data.storage === 'cloud' ? 'Lưu trong tài khoản của bạn.' : 'Lưu trên máy này – đăng nhập để giữ lịch sử trên mọi thiết bị.'}</p>
      {error && <p className="error-box">{error}</p>}
      {!history && !error && <p className="muted loading">⏳ Đang tải…</p>}
      {history && history.summaries.length === 0 && <p className="muted">Chưa có bài nào được chấm.</p>}

      {history && history.summaries.length > 0 && (
        <>
          <div className="chips" role="radiogroup" aria-label="Lọc theo task">
            {([0, 1, 2] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={task === t} className={`chip ${task === t ? 'on' : ''}`} onClick={() => setTask(t)}>
                {t ? `Task ${t}` : 'Tất cả task'}
              </button>
            ))}
            <select className="input topic-filter" aria-label="Lọc theo chủ đề" value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">Mọi chủ đề</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {TOPIC_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </div>

          <section className="card">
            <h3>Tiến bộ theo tiêu chí</h3>
            <HistoryChart rows={chronological} />
          </section>

          {stats && stats.writings > 0 && (
            <section className="card">
              <h3>Lỗi hay gặp</h3>
              <p className="muted small">Tổng hợp từ {stats.writings} bài đã chấm.</p>
              <div className="score-bars" role="table" aria-label="Số lỗi theo loại">
                {ERROR_CATEGORIES.filter((c) => stats.categories[c]).map((c) => (
                  <div key={c} className="score-row" role="row">
                    <span role="rowheader" className="score-name">
                      <span className={`err-sample cat-${c}`}>
                        abc<sup>{CATEGORY_TAGS[c]}</sup>
                      </span>{' '}
                      {CATEGORY_LABELS[c]}
                    </span>
                    <span className="score-track" aria-hidden="true">
                      <span className="score-fill" style={{ width: `${((stats.categories[c] ?? 0) / maxCat) * 100}%`, background: 'var(--series-1)' }} />
                    </span>
                    <span role="cell" className="score-val">
                      <strong>{stats.categories[c]}</strong>
                    </span>
                  </div>
                ))}
              </div>
              <h4>Lỗi lặp lại nhiều nhất</h4>
              <ol className="top-rules">
                {topCounts(stats.rules, 5).map(([rule, n]) => (
                  <li key={rule}>
                    {RULE_LABELS[rule] ?? rule} <span className="muted">· {n} lần</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="card">
            <h3>Các bài đã chấm ({rows.length})</h3>
            <ul className="history-list">
              {rows.map((s) => (
                <li key={s.id}>
                  <button type="button" className="history-row" onClick={() => onOpen(s, history.summaries)}>
                    <span className="history-score">
                      <strong>{s.taskScore}</strong>
                      <span className="small muted">{bandLabel(s.band)}</span>
                    </span>
                    <span className="history-main">
                      <strong>{s.title}</strong>
                      <span className="small muted">
                        Task {s.task} · {TOPIC_LABELS[s.topic] ?? s.topic} · {new Date(s.createdAt).toLocaleDateString('vi-VN')} · {s.wordCount} từ · {minutes(s.durationSec)}
                        {s.attempt > 1 && ` · lần ${s.attempt}`}
                        {s.examId && ' · thi thử'}
                      </span>
                      <span className="small muted">
                        NV {s.criteria.taskFulfilment} · TC {s.criteria.organization} · TV {s.criteria.vocabulary} · NP {s.criteria.grammar}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="btn ghost small-btn" aria-label={`Xoá bài ${s.title}`} onClick={() => void remove(s)}>
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
