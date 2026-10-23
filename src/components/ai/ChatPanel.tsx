import { useEffect, useRef, useState } from 'react';
import { getAiClient } from '../../ai';
import { MAX_USER_CHARS, loadChat, saveChat, type SavedChat } from '../../ai/chatHistory';
import { AiError, CEFR_LEVELS, type ChatMode, type ChatMsg } from '../../ai/types';
import { resolveWords } from '../../data/catalog';
import { loadSelection } from '../../storage/selection';
import { useAiUi } from './AiContext';
import { Markdown } from './Markdown';
import { Sheet } from './Sheet';

const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: 'freeTalk', label: '💬 Free talk', hint: 'Trò chuyện bằng tiếng Anh theo trình độ của bạn.' },
  { id: 'correct', label: '✍️ Sửa lỗi', hint: 'Viết một câu tiếng Anh, AI sửa và giải thích bằng tiếng Việt.' },
  { id: 'explain', label: '📚 Giải thích', hint: 'Hỏi về ngữ pháp, cách dùng từ, phân biệt từ dễ nhầm.' },
  { id: 'practice', label: '🎯 Luyện từ đã chọn', hint: 'AI đặt câu hỏi với bộ từ bạn chọn ở màn Chuẩn bị.' },
];

const STARTERS: Record<ChatMode, string> = {
  freeTalk: "Hi! Let's chat.",
  correct: 'I have went to school yesterday.',
  explain: 'Phân biệt "affect" và "effect"?',
  practice: 'Bắt đầu kiểm tra mình nhé!',
};

export function ChatPanel() {
  const { state, close } = useAiUi();
  const { open, preset, seq } = state.chat;
  const [chat, setChat] = useState<SavedChat>(loadChat);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null); // streaming reply, null when idle
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const update = (next: SavedChat) => {
    setChat(next);
    saveChat(next);
  };

  const send = async (text: string, base: SavedChat = chat) => {
    const content = text.trim();
    if (!content || pending !== null) return;
    const messages: ChatMsg[] = [...base.messages, { role: 'user', content }];
    const withUser = { ...base, messages };
    update(withUser);
    setInput('');
    setError(null);
    setPending('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    let streamed = '';
    try {
      const words =
        base.mode === 'practice'
          ? resolveWords(loadSelection()).map((w) => ({ word: w.word, meaning: w.meaning }))
          : undefined;
      const onDelta = (d: string) => {
        streamed += d;
        setPending(streamed);
      };
      streamed = (await getAiClient().chat({ mode: base.mode, level: base.level, words, messages }, onDelta, ctrl.signal)) || streamed;
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof AiError ? e.message : 'Không gửi được tin nhắn, thử lại sau.');
    } finally {
      // Keep whatever arrived, including a reply the player stopped part-way.
      if (streamed.trim()) update({ ...withUser, messages: [...messages, { role: 'assistant', content: streamed }] });
      setPending(null);
      abort.current = null;
    }
  };

  // Presets (e.g. "Hỏi AI về các từ tôi làm sai") switch mode and send right away.
  useEffect(() => {
    if (!open || !preset) return;
    const base = { ...loadChat(), mode: preset.mode };
    setChat(base);
    if (preset.message) void send(preset.message, base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.messages.length, pending, open]);

  if (!open) return null;

  const mode = MODES.find((m) => m.id === chat.mode)!;
  const practiceCount = chat.mode === 'practice' ? resolveWords(loadSelection()).length : 0;

  return (
    <Sheet
      title="🧑‍🏫 Gia sư AI"
      onClose={() => close('chat')}
      actions={
        <button
          type="button"
          className="btn ghost small"
          disabled={pending !== null || chat.messages.length === 0}
          onClick={() => {
            if (window.confirm('Xoá toàn bộ lịch sử chat?')) update({ ...chat, messages: [] });
          }}
        >
          🗑 Xoá
        </button>
      }
    >
      <div className="chat-controls">
        <div className="chips" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={chat.mode === m.id}
              className={`chip ${chat.mode === m.id ? 'on' : ''}`}
              disabled={pending !== null}
              onClick={() => update({ ...chat, mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {mode.hint}
          {chat.mode === 'practice' && (practiceCount ? ` Đang luyện ${practiceCount} từ.` : ' Bạn chưa chọn từ nào ở màn Chuẩn bị.')}
        </p>
        {chat.mode === 'freeTalk' && (
          <label className="level-select">
            Trình độ:{' '}
            <select value={chat.level} onChange={(e) => update({ ...chat, level: e.target.value as SavedChat['level'] })}>
              {CEFR_LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="chat-list" ref={listRef} aria-live="polite">
        {chat.messages.length === 0 && pending === null && (
          <button type="button" className="chip" onClick={() => void send(STARTERS[chat.mode])}>
            Thử: “{STARTERS[chat.mode]}”
          </button>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {pending !== null && (
          <div className="bubble assistant">{pending ? <Markdown text={pending} /> : <span className="typing">AI đang trả lời…</span>}</div>
        )}
        {error && <p className="error-box">{error}</p>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="input"
          rows={2}
          value={input}
          maxLength={MAX_USER_CHARS}
          placeholder="Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {pending !== null ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            ⏹ Dừng
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()}>
            Gửi
          </button>
        )}
      </form>
    </Sheet>
  );
}
