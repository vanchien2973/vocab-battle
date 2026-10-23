import { useState } from 'react';
import { CRITERIA, CRITERION_LABELS } from '../../vstep/config';
import type { WritingSummary } from '../../vstep/types';
import { CRITERION_COLORS } from './ScoreBars';

const SHORT: Record<string, string> = { taskFulfilment: 'Nhiệm vụ', organization: 'Tổ chức', vocabulary: 'Từ vựng', grammar: 'Ngữ pháp' };
const W = 640;
const H = 220;
const PAD = { left: 30, right: 92, top: 12, bottom: 26 };

/**
 * Criterion scores over time (oldest → newest), one 2px line per criterion in its fixed colour, a legend
 * plus labels at the line ends, and a hover/tap crosshair with all four values.
 */
export function HistoryChart({ rows }: { rows: WritingSummary[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length < 2) return <p className="muted small">Cần ít nhất 2 bài để vẽ biểu đồ tiến bộ.</p>;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / 10) * plotH;
  const last = rows.length - 1;

  // End labels, nudged apart so they never overlap.
  const ends = CRITERIA.map((c) => ({ c, y: y(rows[last].criteria[c]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);

  const pick = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(last, Math.round(((px - PAD.left) / plotW) * last))));
  };
  const h = hover === null ? null : rows[hover];

  return (
    <figure className="history-chart">
      <figcaption className="chart-legend">
        {CRITERIA.map((c) => (
          <span key={c}>
            <span className="swatch" style={{ background: CRITERION_COLORS[c] }} aria-hidden="true" /> {CRITERION_LABELS[c]}
          </span>
        ))}
      </figcaption>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Điểm 4 tiêu chí qua ${rows.length} bài gần nhất; bảng chi tiết ở danh sách bên dưới.`}
          onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => pick(e.clientX, e.currentTarget)}
        >
          {[0, 2, 4, 6, 8, 10].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="grid" />
              <text x={PAD.left - 6} y={y(v) + 4} className="axis" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {h && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />}
          {CRITERIA.map((c) => (
            <g key={c} style={{ color: CRITERION_COLORS[c] }}>
              <polyline fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" points={rows.map((r, i) => `${x(i)},${y(r.criteria[c])}`).join(' ')} />
              {hover !== null && <circle cx={x(hover)} cy={y(rows[hover].criteria[c])} r={4} fill="currentColor" className="dot" />}
            </g>
          ))}
          {ends.map((e) => (
            <text key={e.c} x={PAD.left + plotW + 8} y={e.y + 4} className="end-label">
              {SHORT[e.c]} {rows[last].criteria[e.c]}
            </text>
          ))}
          <text x={PAD.left} y={H - 6} className="axis">
            {new Date(rows[0].createdAt).toLocaleDateString('vi-VN')}
          </text>
          <text x={PAD.left + plotW} y={H - 6} className="axis" textAnchor="end">
            {new Date(rows[last].createdAt).toLocaleDateString('vi-VN')}
          </text>
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${Math.min(80, Math.max(20, (x(hover) / W) * 100))}%` }} role="status">
            <strong>{h.title}</strong>
            <span className="muted small">
              {new Date(h.createdAt).toLocaleDateString('vi-VN')} · Task {h.task} · {h.taskScore} điểm
            </span>
            {CRITERIA.map((c) => (
              <span key={c} className="small">
                <span className="swatch" style={{ background: CRITERION_COLORS[c] }} aria-hidden="true" /> {CRITERION_LABELS[c]}: <strong>{h.criteria[c]}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
