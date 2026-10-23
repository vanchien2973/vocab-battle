import type { ReactNode } from 'react';
import type { GradedSession } from '../../vstep/grading';
import { ScoreHeadline, TaskScores } from './ScoreOverview';

interface Props {
  session: GradedSession;
  actions: ReactNode;
}

/** Result of a graded attempt (one task or a full test). */
export function WritingResult({ session, actions }: Props) {
  return (
    <div className="writing-result">
      <h1>📝 Kết quả chấm</h1>
      <section className="card">
        <ScoreHeadline records={session.records} exam={session.exam} />
      </section>
      {session.records.map((r) => (
        <TaskScores key={r.id} record={r} />
      ))}
      <div className="actions-row">{actions}</div>
    </div>
  );
}
