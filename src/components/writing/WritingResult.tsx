import { useState, type ReactNode } from 'react';
import { CRITERIA, CRITERION_LABELS, type Criterion } from '../../vstep/config';
import type { GradedSession } from '../../vstep/grading';
import type { WritingRecord, WritingSummary } from '../../vstep/types';
import { AnnotatedEssay } from './AnnotatedEssay';
import { PhrasesPanel } from './PhrasesPanel';
import { PromptView } from './PromptView';
import { RewriteView } from './RewriteView';
import { ScoreHeadline, TaskScores } from './ScoreOverview';

type Tab = 'overview' | 'essay' | 'rewrite' | 'phrases';
const TABS: [Tab, string][] = [
  ['overview', '📊 Tổng quan'],
  ['essay', '🖍 Bài viết & lỗi'],
  ['rewrite', '✨ Bản viết lại'],
  ['phrases', '⭐ Cụm từ hay'],
];

interface Props {
  session: GradedSession;
  /** Summaries of the player's history, to compare attempts at the same prompt. */
  history?: WritingSummary[];
  /** "Viết lại bài này": open the prompt again with this essay. */
  onRewrite?: (record: WritingRecord) => void;
  actions: ReactNode;
}

/** Result of a graded attempt (one task or a full test). */
export function WritingResult({ session, history = [], onRewrite, actions }: Props) {
  const [taskIdx, setTaskIdx] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const record = session.records[Math.min(taskIdx, session.records.length - 1)];
  const attempts = history
    .filter((s) => s.promptId === record.promptId && s.id !== record.id && s.createdAt < record.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const previous = attempts[attempts.length - 1]?.criteria;

  return (
    <div className="writing-result">
      <h1>📝 Kết quả chấm</h1>
      <section className="card">
        <ScoreHeadline records={session.records} exam={session.exam} />
      </section>

      {session.records.length > 1 && (
        <div className="chips" role="tablist" aria-label="Task">
          {session.records.map((r, i) => (
            <button key={r.id} type="button" role="tab" aria-selected={taskIdx === i} className={`chip ${taskIdx === i ? 'on' : ''}`} onClick={() => setTaskIdx(i)}>
              Task {r.task} · {r.result.taskScore}
            </button>
          ))}
        </div>
      )}

      <div className="chips tabs" role="tablist" aria-label="Phần kết quả">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {label}
            {t === 'essay' && ` (${record.result.errors.length})`}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <TaskScores record={record} previous={previous} />
          {attempts.length > 0 && <AttemptTable attempts={attempts} current={record} />}
        </>
      )}
      {tab === 'essay' && (
        <section className="card">
          {record.result.errorsError && <p className="notice small">{record.result.errorsError}</p>}
          <AnnotatedEssay text={record.text} errors={record.result.errors} />
        </section>
      )}
      {tab === 'rewrite' && (
        <section className="card">
          {record.result.rewrite ? (
            <RewriteView original={record.text} rewrite={record.result.rewrite} level={record.level} />
          ) : (
            <p className="error-box">{record.result.rewriteError ?? 'Chưa có bản viết lại.'}</p>
          )}
        </section>
      )}
      {tab === 'phrases' && (
        <section className="card">
          <PhrasesPanel key={record.id} phrases={record.result.usefulPhrases} topic={record.topic} />
        </section>
      )}

      <details className="card">
        <summary>Đề bài</summary>
        <PromptView prompt={record.prompt} />
      </details>

      <div className="actions-row">
        {onRewrite && (
          <button type="button" className="btn" onClick={() => onRewrite(record)}>
            ✏️ Viết lại bài này
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}

/** Scores of every attempt at the same prompt, oldest first, the current one last. */
function AttemptTable({ attempts, current }: { attempts: WritingSummary[]; current: WritingRecord }) {
  const rows: { key: string; attempt: number; date: string; task: number; criteria: Record<Criterion, number>; isCurrent: boolean }[] = [
    ...attempts.map((a) => ({ key: a.id, attempt: a.attempt, date: a.createdAt, task: a.taskScore, criteria: a.criteria, isCurrent: false })),
    {
      key: current.id,
      attempt: current.attempt,
      date: current.createdAt,
      task: current.result.taskScore,
      criteria: Object.fromEntries(CRITERIA.map((c) => [c, current.result.criteria[c].score])) as Record<Criterion, number>,
      isCurrent: true,
    },
  ];
  return (
    <section className="card">
      <h3>So sánh các lần làm đề này</h3>
      <div className="table-scroll">
        <table className="attempts">
          <thead>
            <tr>
              <th scope="col">Lần</th>
              <th scope="col">Ngày</th>
              <th scope="col">Điểm task</th>
              {CRITERIA.map((c) => (
                <th key={c} scope="col">
                  {CRITERION_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.isCurrent ? 'current' : ''}>
                <td>
                  {r.attempt}
                  {r.isCurrent && ' (này)'}
                </td>
                <td>{new Date(r.date).toLocaleDateString('vi-VN')}</td>
                <td>
                  <strong>{r.task}</strong>
                </td>
                {CRITERIA.map((c) => (
                  <td key={c}>{r.criteria[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
