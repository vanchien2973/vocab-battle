import { useEffect, useState } from 'react';
import { getAiClient } from '../../ai';
import { useData } from '../../decks/DataContext';
import { gradeDraft, type GradedSession } from '../../vstep/grading';
import { MODE_LABELS, modeMinutes } from '../../vstep/config';
import { hasContent, type WritingDraft } from '../../vstep/drafts';
import { rememberPrompt } from '../../vstep/recentPrompts';
import type { WritingRecord, WritingSummary } from '../../vstep/types';
import { promptIdOf } from '../../vstep/wordCount';
import { WritingEditor } from './WritingEditor';
import { WritingHome, type StartSession } from './WritingHome';
import { WritingResult } from './WritingResult';

type Stage =
  | { name: 'home' }
  | { name: 'write'; draft: WritingDraft }
  | { name: 'grading'; draft: WritingDraft; error?: string }
  | { name: 'result'; session: GradedSession; history?: WritingSummary[] };

export function newDraft(s: StartSession, now = Date.now()): WritingDraft {
  return {
    id: 'current',
    mode: s.mode,
    level: s.level,
    prompts: s.prompts,
    texts: s.texts ?? s.prompts.map(() => ''),
    active: 0,
    startedAt: now,
    deadline: now + modeMinutes(s.mode) * 60_000,
    spellcheck: false,
    ...(s.rewriteOf ? { rewriteOf: s.rewriteOf } : {}),
    savedAt: now,
  };
}

/** "✍️ Luyện Writing": home → timed editor → grading → result; history. */
export function WritingScreen({ onMenu }: { onMenu: () => void }) {
  const data = useData();
  const [stage, setStage] = useState<Stage>({ name: 'home' });
  const [pending, setPending] = useState<WritingDraft | null>(null);

  useEffect(() => {
    let alive = true;
    void data.drafts.load().then((d) => alive && hasContent(d) && setPending(d));
    return () => {
      alive = false;
    };
  }, [data.drafts]);

  const start = (s: StartSession) => {
    const draft = newDraft(s);
    void data.drafts.save(draft);
    for (const p of s.prompts) void promptIdOf(p.text).then((id) => rememberPrompt(id, p.title));
    setPending(null);
    setStage({ name: 'write', draft });
  };

  async function grade(draft: WritingDraft) {
    setStage({ name: 'grading', draft });
    try {
      const session = await gradeDraft(draft, getAiClient(), data.writings);
      await data.drafts.clear();
      setPending(null);
      setStage({ name: 'result', session });
      void loadHistory(session);
    } catch (e) {
      setStage({ name: 'grading', draft, error: (e as Error).message });
    }
  }

  /** Earlier attempts, to compare scores on the result page. */
  async function loadHistory(session: GradedSession) {
    try {
      const { summaries } = await data.writings.history();
      setStage((s) => (s.name === 'result' && s.session === session ? { ...s, history: summaries } : s));
    } catch {
      // the comparison is optional
    }
  }

  const rewrite = (r: WritingRecord) =>
    start({ mode: r.task === 1 ? 'task1' : 'task2', level: r.level, prompts: [r.prompt], texts: [r.text], rewriteOf: r.id });

  if (stage.name === 'write') {
    return (
      <WritingEditor
        key={stage.draft.startedAt}
        draft={stage.draft}
        onSubmit={(draft) => void grade(draft)}
        onQuit={() => {
          void data.drafts.load().then((d) => hasContent(d) && setPending(d));
          setStage({ name: 'home' });
        }}
      />
    );
  }

  if (stage.name === 'grading') {
    const { draft, error } = stage;
    // An expired exam would submit again at once: give two minutes to fix it (e.g. an essay that is too long).
    const reopen = () => setStage({ name: 'write', draft: draft.mode === 'exam' && draft.deadline <= Date.now() ? { ...draft, deadline: Date.now() + 120_000 } : draft });
    return (
      <div className="writing-home grading" aria-busy={!error}>
        {error ? (
          <>
            <h1>⚠️ Chưa chấm được bài</h1>
            <p className="error-box">{error}</p>
            <p className="muted small">Bài viết vẫn được lưu nháp trên máy này.</p>
            <div className="actions-row">
              <button type="button" className="btn primary" onClick={() => void grade(draft)}>
                🔁 Chấm lại
              </button>
              <button type="button" className="btn" onClick={reopen}>
                ✏️ Quay lại sửa bài
              </button>
              <button type="button" className="btn ghost" onClick={() => setStage({ name: 'home' })}>
                Về trang Writing
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>⏳ AI đang chấm bài…</h1>
            <p className="muted">Chấm theo 4 tiêu chí VSTEP, tìm lỗi và viết lại bài tham khảo – thường mất 20–40 giây.</p>
          </>
        )}
      </div>
    );
  }

  if (stage.name === 'result') {
    return (
      <WritingResult
        session={stage.session}
        history={stage.history}
        onRewrite={rewrite}
        actions={
          <>
            <button type="button" className="btn primary" onClick={() => setStage({ name: 'home' })}>
              ✍️ Viết bài mới
            </button>
            <button type="button" className="btn ghost" onClick={onMenu}>
              Menu
            </button>
          </>
        }
      />
    );
  }

  return (
    <WritingHome
      onStart={start}
      onHistory={() => undefined}
      onMenu={onMenu}
      draftBanner={
        pending && (
          <div className="notice card" role="status">
            <p>
              📝 Bạn có bài viết dở: <strong>{MODE_LABELS[pending.mode]}</strong> – “{pending.prompts[0]?.title}”, lưu lúc{' '}
              {new Date(pending.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.
              {pending.deadline < Date.now() && ' Đã hết giờ làm bài.'}
            </p>
            <div className="actions-row">
              <button type="button" className="btn primary" onClick={() => setStage({ name: 'write', draft: pending })}>
                Viết tiếp
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  void data.drafts.clear();
                  setPending(null);
                }}
              >
                Bỏ nháp
              </button>
            </div>
          </div>
        )
      }
    />
  );
}
