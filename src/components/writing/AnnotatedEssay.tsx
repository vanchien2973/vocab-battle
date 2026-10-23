import { useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, ERROR_CATEGORIES, RULE_LABELS, type ErrorCategory } from '../../vstep/config';
import { locateErrors, segments } from '../../vstep/locateErrors';
import type { WritingError } from '../../vstep/types';
import { useAiUi } from '../ai/AiContext';

/**
 * Category marks: three hues that stay distinct for colour-blind readers, combined with an underline
 * style and a short tag, so a category is never told by colour alone.
 */
export const CATEGORY_TAGS: Record<ErrorCategory, string> = {
  grammar: 'NP',
  vocabulary: 'TV',
  spelling: 'CT',
  punctuation: 'DC',
  coherence: 'ML',
  task: 'ĐB',
  register: 'VP',
};

/** The sentence around a span, for "Hỏi AI" context. */
function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const s = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1;
  const after = text.slice(end).search(/[.!?\n]/);
  return text.slice(s, after < 0 ? text.length : end + after + 1).trim();
}

export function askAiMessage(e: WritingError, sentence: string | null): string {
  const where = sentence ? ` trong câu: "${sentence}"` : '';
  const category = CATEGORY_LABELS[e.category];
  const rule = RULE_LABELS[e.rule] ?? e.rule;
  const kind = rule.toLowerCase() === category.toLowerCase() || e.rule === 'other' ? category.toLowerCase() : `${category.toLowerCase()} – ${rule.toLowerCase()}`;
  return (
    `Trong bài viết VSTEP của mình có đoạn "${e.quote}"${where}. AI chấm là lỗi ${kind} ` +
    `và sửa thành "${e.correction}". Giải thích kỹ hơn vì sao sai, khi nào dùng đúng, và cho 2-3 câu ví dụ đúng giúp mình.`
  );
}

/** The essay with each located error underlined by category, a filter, a legend and a details popover. */
export function AnnotatedEssay({ text, errors }: { text: string; errors: WritingError[] }) {
  const { openChat } = useAiUi();
  const located = useMemo(() => locateErrors(text, errors), [text, errors]);
  const [hidden, setHidden] = useState<Set<ErrorCategory>>(new Set());
  const [open, setOpen] = useState<{ index: number; top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const present = ERROR_CATEGORIES.filter((c) => errors.some((e) => e.category === c));
  const spanOf = (i: number) => located.spans.find((s) => s.index === i);

  const show = (index: number, el: HTMLElement) => {
    const b = box.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setOpen({ index, top: r.bottom - b.top + 6, left: Math.max(0, Math.min(r.left - b.left, b.width - 300)) });
  };

  const current = open ? errors[open.index] : null;
  const span = open ? spanOf(open.index) : undefined;

  return (
    <div className="annotated">
      <div className="chips error-filter" role="group" aria-label="Lọc loại lỗi">
        {present.map((c) => {
          const n = errors.filter((e) => e.category === c).length;
          const on = !hidden.has(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              className={`chip err-chip cat-${c} ${on ? 'on' : ''}`}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (on) next.add(c);
                  else next.delete(c);
                  return next;
                })
              }
            >
              <span className={`err-sample cat-${c}`}>
                abc<sup>{CATEGORY_TAGS[c]}</sup>
              </span>{' '}
              {CATEGORY_LABELS[c]} ({n})
            </button>
          );
        })}
        {errors.length === 0 && <p className="muted">AI không tìm thấy lỗi cụ thể nào 🎉</p>}
      </div>

      <div className="essay-box" ref={box} lang="en" onMouseLeave={() => setOpen(null)} onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}>
        {segments(text, located.spans).map((seg, i) => {
          if (seg.index === null) return <span key={i}>{seg.text}</span>;
          const e = errors[seg.index];
          if (hidden.has(e.category)) return <span key={i}>{seg.text}</span>;
          const idx = seg.index;
          return (
            <button
              key={i}
              type="button"
              className={`err cat-${e.category} ${e.severity}`}
              aria-label={`${seg.text} – lỗi ${CATEGORY_LABELS[e.category]}: sửa thành ${e.correction}`}
              aria-expanded={open?.index === idx}
              onMouseEnter={(ev) => show(idx, ev.currentTarget)}
              onFocus={(ev) => show(idx, ev.currentTarget)}
              // Touch fires mouseenter right before click, so a click always opens (never toggles).
              onClick={(ev) => show(idx, ev.currentTarget)}
            >
              {seg.text}
              <sup aria-hidden="true">{CATEGORY_TAGS[e.category]}</sup>
            </button>
          );
        })}
        {current && open && (
          <div className="err-pop card" role="dialog" aria-label="Chi tiết lỗi" style={{ top: open.top, left: open.left }} lang="vi">
            <p className="small muted">
              <span className={`err-sample cat-${current.category}`}>
                abc<sup>{CATEGORY_TAGS[current.category]}</sup>
              </span>{' '}
              {CATEGORY_LABELS[current.category]} · {RULE_LABELS[current.rule] ?? current.rule}
              {current.severity === 'major' && ' · lỗi nặng'}
            </p>
            <p lang="en">
              <del>{current.quote}</del> → <strong>{current.correction || '(bỏ)'}</strong>
            </p>
            {current.explanationVi && <p className="small">{current.explanationVi}</p>}
            <button
              type="button"
              className="btn small-btn"
              onClick={() => openChat({ mode: 'explain', message: askAiMessage(current, span ? sentenceAround(text, span.start, span.end) : null) })}
            >
              💬 Hỏi AI về lỗi này
            </button>
          </div>
        )}
      </div>

      {located.general.length > 0 && (
        <section className="general-errors">
          <h4>Lỗi chung ({located.general.length})</h4>
          <p className="muted small">Những lỗi không định vị được trong bài (AI trích chưa khớp nguyên văn, hoặc chồng lên lỗi khác).</p>
          <ul>
            {located.general.map((i) => {
              const e = errors[i];
              return (
                <li key={i}>
                  <span className={`err-sample cat-${e.category}`}>
                    abc<sup>{CATEGORY_TAGS[e.category]}</sup>
                  </span>{' '}
                  <span lang="en">
                    <del>{e.quote}</del> → <strong>{e.correction || '(bỏ)'}</strong>
                  </span>
                  {e.explanationVi && <span className="small muted"> – {e.explanationVi}</span>}{' '}
                  <button type="button" className="link-btn small" onClick={() => openChat({ mode: 'explain', message: askAiMessage(e, null) })}>
                    Hỏi AI
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
