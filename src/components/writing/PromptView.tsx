import { ESSAY_TYPE_LABELS, taskConfig, TOPIC_LABELS } from '../../vstep/config';
import type { WritingPrompt } from '../../vstep/types';

const REGISTER_LABELS: Record<string, string> = { formal: 'Trang trọng', informal: 'Thân mật', 'semi-formal': 'Bán trang trọng' };

/** A prompt as the candidate reads it, with its task, topic and requirements. */
export function PromptView({ prompt, compact }: { prompt: WritingPrompt; compact?: boolean }) {
  const cfg = taskConfig(prompt.task);
  return (
    <article className="prompt-view">
      <p className="prompt-meta small">
        <span className="badge">{cfg.label}</span> <span className="badge">{TOPIC_LABELS[prompt.topic] ?? prompt.topic}</span>
        {prompt.essayType && <span className="badge">{ESSAY_TYPE_LABELS[prompt.essayType] ?? prompt.essayType}</span>}
        {prompt.register && <span className="badge">{REGISTER_LABELS[prompt.register] ?? prompt.register}</span>}
      </p>
      {!compact && <h4>{prompt.title}</h4>}
      <p className="prompt-text" lang="en">
        {prompt.text}
      </p>
      {prompt.requirements.length > 0 && (
        <ul className="small" lang="en">
          {prompt.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Tối thiểu {cfg.minWords} từ · gợi ý {cfg.minutes} phút
      </p>
    </article>
  );
}
