import { readJSON, writeJSON } from '../storage/safeStorage';
import { prompts } from './shared';
import { CEFR_LEVELS, CHAT_MODES, type ChatMode, type ChatMsg, type ChatRequest } from './types';

// Same limits as api/Core/ChatService.cs.
export const MAX_MESSAGES = 20;
export const MAX_USER_CHARS = 1000;
export const MAX_ASSISTANT_CHARS = 1500;
export const MAX_TOTAL_CHARS = 8000;
export const MAX_WORDS = 50;

/**
 * Keep user/assistant turns, cap each message, keep the last 20, drop the oldest until the total fits,
 * and start with a user turn.
 */
export function trimHistory(history: readonly ChatMsg[]): ChatMsg[] {
  let msgs = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS) }))
    .slice(-MAX_MESSAGES);
  const total = () => msgs.reduce((n, m) => n + m.content.length, 0);
  while (msgs.length > 1 && total() > MAX_TOTAL_CHARS) msgs = msgs.slice(1);
  while (msgs.length > 0 && msgs[0].role !== 'user') msgs = msgs.slice(1);
  return msgs;
}

const PHRASE_TYPES: readonly string[] = ['collocation', 'phrasal_verb', 'idiom', 'pattern'];

/** Learner info as data for the first user turn (never the system prompt). Mirrors ChatService.ContextNote. */
export function contextNote(level: ChatRequest['level'], words: ChatRequest['words']): string | null {
  const lv = level && CEFR_LEVELS.includes(level) ? level : null;
  const list = (words ?? [])
    .filter((w) => w.word.trim() !== '')
    .slice(0, MAX_WORDS)
    .map((w) => {
      let text = w.word.trim().slice(0, 80);
      if (w.type && PHRASE_TYPES.includes(w.type)) text += ` [${w.type.replace('_', ' ')}]`;
      return w.meaning ? `${text} (${w.meaning.slice(0, 60)})` : text;
    });
  if (!lv && list.length === 0) return null;
  return prompts.contextTemplate.replace('{level}', lv ?? 'unknown').replace('{words}', list.length ? list.join('; ') : 'none');
}

/** System prompt + messages exactly as the server builds them (used for direct BYOK calls). */
export function prepareChat(req: ChatRequest): { system: string; messages: ChatMsg[] } {
  const messages = trimHistory(req.messages);
  const note = contextNote(req.level, req.words);
  if (note && messages.length) messages[0] = { ...messages[0], content: `${note}\n\n${messages[0].content}` };
  return { system: `${prompts.chatBase}\n\n${prompts.chatModes[req.mode]}`, messages };
}

// ---------- saved conversation ----------

export interface SavedChat {
  mode: ChatMode;
  level: NonNullable<ChatRequest['level']>;
  messages: ChatMsg[];
}

const KEY = 'vocab-battle.chat.v1';
/** Stored history is longer than what is sent, so the player can scroll back. */
const MAX_STORED = 100;

export function loadChat(): SavedChat {
  const s = readJSON<Partial<SavedChat>>(KEY, {});
  return {
    mode: s.mode && CHAT_MODES.includes(s.mode) ? s.mode : 'freeTalk',
    level: s.level && CEFR_LEVELS.includes(s.level) ? s.level : 'A2',
    messages: Array.isArray(s.messages)
      ? s.messages.filter((m): m is ChatMsg => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [],
  };
}

export function saveChat(chat: SavedChat): void {
  writeJSON(KEY, { ...chat, messages: chat.messages.slice(-MAX_STORED) });
}
