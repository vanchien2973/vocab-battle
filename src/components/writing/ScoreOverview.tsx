import { CRITERIA, CRITERION_LABELS, taskConfig, type Criterion, type TaskNo } from '../../vstep/config';
import { bandLabel, bandOf, writingScore } from '../../vstep/scoring';
import type { WritingRecord } from '../../vstep/types';
import { CRITERION_COLORS, ScoreBars } from './ScoreBars';

const scoresOf = (r: WritingRecord) => Object.fromEntries(CRITERIA.map((c) => [c, r.result.criteria[c].score])) as Record<Criterion, number>;

/** Headline numbers: task score(s), estimated level and, for a full test, the Writing score. */
export function ScoreHeadline({ records, exam }: { records: WritingRecord[]; exam: boolean }) {
  const byTask = (t: TaskNo) => records.find((r) => r.task === t)?.result.taskScore ?? 0;
  const total = exam ? writingScore(byTask(1), byTask(2)) : null;
  return (
    <>
      <div className="score-hero">
        {total !== null && (
          <div className="stat">
            <strong>{total}</strong>
            <span className="muted">Điểm Writing · {bandLabel(bandOf(total))}</span>
          </div>
        )}
        {(exam ? ([1, 2] as TaskNo[]) : [records[0].task]).map((t) => {
          const r = records.find((x) => x.task === t);
          return (
            <div key={t} className="stat">
              <strong>{r ? r.result.taskScore : '–'}</strong>
              <span className="muted">
                Task {t} · {r ? bandLabel(r.result.band) : 'không làm bài (0 điểm)'}
              </span>
            </div>
          );
        })}
      </div>
      {exam && <p className="muted small">Điểm Writing = (Task 1 + Task 2 × 2) / 3, làm tròn 0.5.</p>}
      <p className="disclaimer">Điểm là ước lượng của AI để luyện tập, không thay cho chấm chính thức.</p>
    </>
  );
}

/** One task: criterion bars, comments with quoted evidence, strengths and what to improve. */
export function TaskScores({ record, previous }: { record: WritingRecord; previous?: Record<Criterion, number> }) {
  const r = record.result;
  return (
    <section className="card">
      <h3>
        {taskConfig(record.task).label} · {r.taskScore}/10
      </h3>
      <p className="muted small">
        {r.wordCount} từ (tối thiểu {r.minWords}){r.shortPenalty && ' · bài chưa đủ độ dài nên điểm Hoàn thành nhiệm vụ bị giới hạn'}
        {record.attempt > 1 && ` · lần làm thứ ${record.attempt}`}
      </p>
      {previous && <p className="muted small">Vạch trắng trên mỗi thanh là điểm lần làm trước.</p>}
      <ScoreBars scores={scoresOf(record)} previous={previous} />
      <div className="criterion-notes">
        {CRITERIA.map((c) => (
          <div key={c}>
            <h4>
              <span className="swatch" style={{ background: CRITERION_COLORS[c] }} aria-hidden="true" /> {CRITERION_LABELS[c]} · {r.criteria[c].score}
            </h4>
            <p>{r.criteria[c].comment}</p>
            {r.criteria[c].evidence.map((e) => (
              <blockquote key={e} lang="en">
                “{e}”
              </blockquote>
            ))}
          </div>
        ))}
      </div>
      {r.strengths.length > 0 && (
        <>
          <h4>👍 Điểm mạnh</h4>
          <ul>
            {r.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {r.improvements.length > 0 && (
        <>
          <h4>🎯 Cần cải thiện</h4>
          <ul>
            {r.improvements.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
