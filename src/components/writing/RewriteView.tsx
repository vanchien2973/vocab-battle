import { useMemo } from 'react';
import { changeRatio, wordDiff } from '../../vstep/diff';
import { countWords } from '../../vstep/wordCount';

/** The original essay and the rewrite side by side, with the words that differ marked on both sides. */
export function RewriteView({ original, rewrite, level }: { original: string; rewrite: string; level: string }) {
  const d = useMemo(() => wordDiff(original, rewrite), [original, rewrite]);
  return (
    <div className="rewrite">
      <p className="muted small">
        Bản viết lại ở bậc {level}, giữ ý của bạn · {countWords(rewrite)} từ · khoảng {Math.round(changeRatio(d) * 100)}% từ được thay đổi. Phần{' '}
        <del className="diff-del">gạch đỏ</del> là chỗ bỏ/sửa trong bài gốc, phần <ins className="diff-ins">gạch xanh</ins> là chỗ mới trong bản viết lại.
      </p>
      <div className="rewrite-cols">
        <section aria-label="Bài gốc">
          <h4>Bài của bạn</h4>
          <div className="essay-box" lang="en">
            {d.before.map((t, i) => (t.changed ? <del key={i} className="diff-del">{t.text}</del> : <span key={i}>{t.text}</span>))}
          </div>
        </section>
        <section aria-label="Bản viết lại">
          <h4>Bản viết lại</h4>
          <div className="essay-box" lang="en">
            {d.after.map((t, i) => (t.changed ? <ins key={i} className="diff-ins">{t.text}</ins> : <span key={i}>{t.text}</span>))}
          </div>
        </section>
      </div>
    </div>
  );
}
