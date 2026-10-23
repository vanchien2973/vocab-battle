import { useState } from 'react';
import { getAiClient } from '../../ai';
import { customPrompt } from '../../vstep/aiTasks';
import { ESSAY_TYPE_LABELS, MODE_LABELS, modeMinutes, modeTasks, TARGET_LEVELS, taskConfig, VSTEP, type TargetLevel, type WritingMode } from '../../vstep/config';
import { avoidTitles } from '../../vstep/recentPrompts';
import type { WritingPrompt } from '../../vstep/types';
import { PromptView } from './PromptView';

export interface StartSession {
  mode: WritingMode;
  level: TargetLevel;
  prompts: WritingPrompt[];
  texts?: string[];
  rewriteOf?: string;
}

interface Props {
  onStart: (s: StartSession) => void;
  onHistory: () => void;
  onMenu: () => void;
  /** Shown above the form when an unfinished draft exists. */
  draftBanner?: React.ReactNode;
}

const MODES: WritingMode[] = ['task1', 'task2', 'exam'];

/** "Luyện Writing VSTEP": choose task(s), target level and where the prompt comes from. */
export function WritingHome({ onStart, onHistory, onMenu, draftBanner }: Props) {
  const [mode, setMode] = useState<WritingMode>('task2');
  const [level, setLevel] = useState<TargetLevel>('B2');
  const [source, setSource] = useState<'ai' | 'custom'>('ai');
  const [topic, setTopic] = useState('random');
  const [essayType, setEssayType] = useState('');
  const [custom, setCustom] = useState<string[]>(['', '']);
  const [prompts, setPrompts] = useState<WritingPrompt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = modeTasks(mode);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const ai = getAiClient();
      const avoid = avoidTitles();
      setPrompts(await Promise.all(tasks.map((task) => ai.generateWritingPrompt({ task, level, topic, essayType: task === 2 ? essayType : '', avoid }))));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startCustom = () => {
    try {
      onStart({ mode, level, prompts: tasks.map((task, i) => customPrompt(task, custom[i])) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const chip = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={current === value}
      className={`chip ${current === value ? 'on' : ''}`}
      onClick={() => {
        set(value);
        setPrompts(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="writing-home">
      <header className="page-head">
        <button type="button" className="btn ghost" onClick={onMenu}>
          ← Menu
        </button>
        <h1>✍️ Luyện Writing VSTEP</h1>
        <button type="button" className="btn" onClick={onHistory}>
          📈 Lịch sử
        </button>
      </header>
      {draftBanner}

      <section className="card form-grid">
        <h3>Chế độ</h3>
        <div className="chips" role="radiogroup" aria-label="Chế độ">
          {MODES.map((m) => chip(m, mode, setMode, MODE_LABELS[m]))}
        </div>
        <p className="muted small">
          {mode === 'exam'
            ? `Hai task dùng chung đồng hồ ${VSTEP.examMinutes} phút, chuyển qua lại tuỳ ý; hết giờ tự nộp. Không dán được văn bản.`
            : `Tối thiểu ${taskConfig(tasks[0]).minWords} từ, gợi ý ${modeMinutes(mode)} phút. Được dán văn bản và bật kiểm tra chính tả nếu muốn.`}
        </p>

        <h3>Bậc mục tiêu</h3>
        <div className="chips" role="radiogroup" aria-label="Bậc mục tiêu">
          {TARGET_LEVELS.map((l) => chip(l, level, setLevel, l))}
        </div>
        <p className="muted small">Ảnh hưởng độ khó của đề AI ra và văn phong của bản viết lại tham khảo.</p>

        <h3>Đề bài</h3>
        <div className="chips" role="radiogroup" aria-label="Nguồn đề">
          {chip('ai', source, setSource, '🤖 AI ra đề')}
          {chip('custom', source, setSource, '📋 Tự nhập đề')}
        </div>

        {source === 'ai' ? (
          <>
            <div className="chips" role="radiogroup" aria-label="Chủ đề">
              {chip('random', topic, setTopic, '🎲 Ngẫu nhiên')}
              {VSTEP.topics.map((t) => chip(t.id, topic, setTopic, t.label))}
            </div>
            {tasks.includes(2) && (
              <div className="chips" role="radiogroup" aria-label="Dạng bài Task 2">
                {chip('', essayType, setEssayType, 'Dạng bài bất kỳ')}
                {VSTEP.essayTypes.map((t) => chip(t.id, essayType, setEssayType, ESSAY_TYPE_LABELS[t.id]))}
              </div>
            )}
            <p className="muted small">AI tự soạn đề luyện tập theo đúng format VSTEP – không dùng đề thi thật hay đề sách có bản quyền.</p>
          </>
        ) : (
          tasks.map((task, i) => (
            <label key={task}>
              {taskConfig(task).label}
              <textarea
                className="input"
                rows={6}
                maxLength={VSTEP.maxPromptLength}
                value={custom[i]}
                onChange={(e) => setCustom((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="Dán đề bài (tiếng Anh) vào đây…"
              />
            </label>
          ))
        )}
      </section>

      {error && <p className="error-box">{error}</p>}

      {source === 'ai' && prompts && (
        <section className="card">
          <h3>Đề của bạn</h3>
          {prompts.map((p) => (
            <PromptView key={p.task} prompt={p} />
          ))}
        </section>
      )}

      <div className="actions-row">
        {source === 'ai' ? (
          <>
            <button type="button" className={`btn ${prompts ? '' : 'primary big'}`} disabled={busy} onClick={() => void generate()}>
              {busy ? '⏳ Đang ra đề…' : prompts ? '🔄 Đổi đề khác' : '🤖 Ra đề'}
            </button>
            {prompts && (
              <button type="button" className="btn primary big" onClick={() => onStart({ mode, level, prompts })}>
                ✍️ Bắt đầu viết ({modeMinutes(mode)} phút)
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn primary big" disabled={tasks.some((_, i) => !custom[i].trim())} onClick={startCustom}>
            ✍️ Bắt đầu viết ({modeMinutes(mode)} phút)
          </button>
        )}
      </div>
    </div>
  );
}
