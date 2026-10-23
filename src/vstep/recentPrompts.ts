import { readJSON, writeJSON } from '../storage/safeStorage';
import { VSTEP } from './config';

const KEY = 'vocab-battle.vstep.recentPrompts.v1';

export interface RecentPrompt {
  promptId: string;
  title: string;
  at: string;
}

/** Prompts used lately on this device, newest first (titles go to the AI as "do not repeat"). */
export const loadRecentPrompts = (): RecentPrompt[] => readJSON<RecentPrompt[]>(KEY, []);

export function rememberPrompt(promptId: string, title: string, now = new Date()) {
  const list = [{ promptId, title, at: now.toISOString() }, ...loadRecentPrompts().filter((p) => p.promptId !== promptId)];
  writeJSON(KEY, list.slice(0, VSTEP.recentPromptsKept));
}

/** Titles to avoid when generating the next prompt. */
export const avoidTitles = () => loadRecentPrompts().slice(0, VSTEP.maxAvoid).map((p) => p.title);

export const wasUsedRecently = (promptId: string) => loadRecentPrompts().some((p) => p.promptId === promptId);
