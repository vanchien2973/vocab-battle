import { CRITERIA, CRITERION_LABELS, type Criterion } from '../../vstep/config';

/** Fixed colour per criterion (same in every chart), validated for the dark card surface. */
export const CRITERION_COLORS: Record<Criterion, string> = {
  taskFulfilment: 'var(--series-1)',
  organization: 'var(--series-2)',
  vocabulary: 'var(--series-3)',
  grammar: 'var(--series-4)',
};

/** Horizontal bars 0–10, one per criterion, each labelled with its name and score (never colour alone). */
export function ScoreBars({ scores, previous }: { scores: Record<Criterion, number>; previous?: Record<Criterion, number> }) {
  return (
    <div className="score-bars" role="table" aria-label="Điểm theo tiêu chí (thang 10)">
      {CRITERIA.map((c) => {
        const diff = previous ? scores[c] - previous[c] : 0;
        return (
          <div key={c} className="score-row" role="row" title={`${CRITERION_LABELS[c]}: ${scores[c]}/10`}>
            <span role="rowheader" className="score-name">
              {CRITERION_LABELS[c]}
            </span>
            <span className="score-track" aria-hidden="true">
              {previous && <span className="score-prev" style={{ left: `${previous[c] * 10}%` }} title={`Lần trước: ${previous[c]}`} />}
              <span className="score-fill" style={{ width: `${scores[c] * 10}%`, background: CRITERION_COLORS[c] }} />
            </span>
            <span role="cell" className="score-val">
              <strong>{scores[c]}</strong>
              {previous && diff !== 0 && <span className={`small ${diff > 0 ? 'up' : 'down'}`}> {diff > 0 ? `▲${diff}` : `▼${-diff}`}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
