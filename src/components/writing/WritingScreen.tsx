import { useEffect, useState } from 'react';
import { useData } from '../../decks/DataContext';
import { MODE_LABELS, modeMinutes } from '../../vstep/config';
import { hasContent, type WritingDraft } from '../../vstep/drafts';
import { rememberPrompt } from '../../vstep/recentPrompts';
import { promptIdOf } from '../../vstep/wordCount';
import { WritingEditor } from './WritingEditor';
import { WritingHome, type StartSession } from './WritingHome';

type Stage = { name: 'home' } | { name: 'write'; draft: WritingDraft } | { name: 'submitted'; draft: WritingDraft };

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

  if (stage.name === 'write') {
    return (
      <WritingEditor
        key={stage.draft.startedAt}
        draft={stage.draft}
        onSubmit={(draft) => setStage({ name: 'submitted', draft })}
        onQuit={() => {
          void data.drafts.load().then((d) => hasContent(d) && setPending(d));
          setStage({ name: 'home' });
        }}
      />
    );
  }

  if (stage.name === 'submitted') {
    return (
      <div className="writing-home">
        <h1>✅ Đã nộp bài</h1>
        <button type="button" className="btn" onClick={() => setStage({ name: 'home' })}>
          ← Quay lại
        </button>
      </div>
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
