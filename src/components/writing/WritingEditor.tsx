import { useEffect, useRef, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { taskConfig, VSTEP } from '../../vstep/config';
import { DraftAutosaver, type WritingDraft } from '../../vstep/drafts';
import { autoSubmitsOnExpire, clockState, formatClock, WritingClock, type ClockState } from '../../vstep/timer';
import { countWords } from '../../vstep/wordCount';
import { useCompactHeader } from '../ai/AiContext';
import { PromptView } from './PromptView';

interface Props {
  /** New or restored draft; the clock runs to its deadline. */
  draft: WritingDraft;
  onSubmit: (draft: WritingDraft) => void;
  /** Leave without submitting (the draft stays saved). */
  onQuit: () => void;
}

/** Timed writing screen: prompt on the left, plain-text editor on the right, word count and countdown. */
export function WritingEditor({ draft: initial, onSubmit, onQuit }: Props) {
  useCompactHeader();
  const { drafts } = useData();
  const exam = initial.mode === 'exam';
  const [texts, setTexts] = useState(initial.texts);
  const [active, setActive] = useState(initial.active);
  const [spellcheck, setSpellcheck] = useState(initial.spellcheck && !exam);
  const [clock, setClock] = useState<ClockState>(() => clockState(initial.deadline, Date.now()));
  const [locked, setLocked] = useState(false);
  const [overtime, setOvertime] = useState(false);
  const [askSubmit, setAskSubmit] = useState<'expired' | 'confirm' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const area = useRef<HTMLTextAreaElement>(null);

  const draft: WritingDraft = { ...initial, texts, active, spellcheck, savedAt: initial.savedAt };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const submitted = useRef(false);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const submit = () => {
    if (submitted.current) return;
    submitted.current = true;
    onSubmit(draftRef.current);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Auto-save every few seconds, and when the tab is hidden or closed.
  useEffect(() => {
    const saver = new DraftAutosaver(drafts, () => draftRef.current, VSTEP.draftSaveSeconds * 1000).start();
    const flush = () => void saver.flush();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      saver.stop();
      flush();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [drafts]);

  useEffect(() => {
    const c = new WritingClock(initial.deadline, {
      onTick: setClock,
      onWarn: (w) => showToast(`⏰ Còn ${Math.round(w / 60)} phút`),
      onExpire: () => {
        setLocked(true);
        if (autoSubmitsOnExpire(initial.mode)) {
          showToast('⏰ Hết giờ – bài đã được nộp tự động.');
          submitRef.current();
        } else {
          setAskSubmit('expired');
        }
      },
    }).start();
    return () => {
      c.stop();
      clearTimeout(toastTimer.current);
    };
  }, [initial.deadline, initial.mode]);

  const counts = texts.map(countWords);
  const task = initial.prompts[active].task;
  const min = taskConfig(task).minWords;
  const words = counts[active];
  const tooLong = words > VSTEP.maxWords;
  const short = initial.prompts.map((p, i) => counts[i] < taskConfig(p.task).minWords);

  const blockPaste = (e: React.ClipboardEvent | React.DragEvent) => {
    if (!exam) return;
    e.preventDefault();
    showToast('🚫 Chế độ Thi thử không cho dán văn bản – hãy tự gõ như khi thi thật.');
  };

  return (
    <div className="writing-editor">
      <header className="writing-bar">
        <button type="button" className="btn ghost small-btn" onClick={onQuit} title="Thoát (nháp vẫn được lưu)">
          ✕
        </button>
        {exam ? (
          <div className="chips" role="tablist" aria-label="Task">
            {initial.prompts.map((p, i) => (
              <button
                key={p.task}
                type="button"
                role="tab"
                aria-selected={active === i}
                className={`chip ${active === i ? 'on' : ''}`}
                onClick={() => {
                  setActive(i);
                  area.current?.focus();
                }}
              >
                Task {p.task} · {counts[i]} từ
              </button>
            ))}
          </div>
        ) : (
          <strong>{taskConfig(task).label}</strong>
        )}
        <span className={`writing-clock warn-${clock.warnLevel}`} role="timer" aria-live="off" aria-label={`Còn ${formatClock(clock.remaining)}`}>
          {overtime ? '⏰ Quá giờ' : `⏱ ${formatClock(clock.remaining)}`}
        </span>
        <span className={`word-count ${tooLong ? 'bad' : words < min ? 'short' : 'ok'}`} aria-live="polite">
          {words}/{min} từ
        </span>
        {!exam && (
          <label className="check small" title="Kiểm tra chính tả của trình duyệt (thi thật không có)">
            <input type="checkbox" checked={spellcheck} onChange={(e) => setSpellcheck(e.target.checked)} /> Chính tả
          </label>
        )}
        <button type="button" className="btn primary" onClick={() => setAskSubmit('confirm')}>
          Nộp bài
        </button>
      </header>

      <div className={`writing-body ${promptOpen ? '' : 'prompt-closed'}`}>
        <aside className="prompt-panel">
          <button type="button" className="link-btn small" aria-expanded={promptOpen} onClick={() => setPromptOpen((o) => !o)}>
            {promptOpen ? '◀ Thu gọn đề' : '▶ Xem đề'}
          </button>
          {promptOpen && <PromptView prompt={initial.prompts[active]} />}
        </aside>
        <main className="writing-main">
          <textarea
            ref={area}
            className="writing-area"
            aria-label={`Bài viết Task ${task}`}
            lang="en"
            value={texts[active]}
            readOnly={locked}
            spellCheck={spellcheck}
            autoCorrect={spellcheck ? 'on' : 'off'}
            autoCapitalize={spellcheck ? 'sentences' : 'off'}
            autoComplete="off"
            onPaste={blockPaste}
            onDrop={blockPaste}
            onChange={(e) => {
              const v = e.target.value;
              setTexts((t) => t.map((x, i) => (i === active ? v : x)));
            }}
            placeholder="Viết bài của bạn ở đây…"
            autoFocus
          />
          {tooLong && <p className="error-box small">Bài dài quá {VSTEP.maxWords} từ – hãy rút gọn trước khi nộp.</p>}
          <p className="muted small">Nháp tự lưu mỗi {VSTEP.draftSaveSeconds} giây trên máy này – lỡ đóng tab vẫn mở lại được.</p>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {askSubmit && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="modal card">
            <h3 id="submit-title">{askSubmit === 'expired' ? '⏰ Hết giờ' : 'Nộp bài để chấm?'}</h3>
            {initial.prompts.map((p, i) => (
              <p key={p.task} className={short[i] ? 'short' : ''}>
                Task {p.task}: {counts[i]} từ {short[i] && `(chưa đủ ${taskConfig(p.task).minWords} – sẽ bị trừ điểm hoàn thành nhiệm vụ)`}
              </p>
            ))}
            <div className="actions-row">
              {askSubmit === 'expired' ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setLocked(false);
                    setOvertime(true);
                    setAskSubmit(null);
                  }}
                >
                  Viết thêm (quá giờ)
                </button>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setAskSubmit(null)}>
                  Viết tiếp
                </button>
              )}
              <button type="button" className="btn primary" disabled={counts.some((n) => n > VSTEP.maxWords) || counts.every((n) => n === 0)} onClick={submit}>
                Nộp bài
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
