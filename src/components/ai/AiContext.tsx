import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatMode } from '../../ai/types';

export interface ChatPreset {
  mode: ChatMode;
  /** Sent right away when the chat opens. */
  message?: string;
}

interface AiUi {
  openDictionary: (word?: string) => void;
  openChat: (preset?: ChatPreset) => void;
  openSettings: () => void;
  /** Battle screens shrink the header to icons. */
  setCompact: (compact: boolean) => void;
}

interface AiUiState {
  dictionary: { open: boolean; word: string; seq: number };
  chat: { open: boolean; preset: ChatPreset | null; seq: number };
  settingsOpen: boolean;
  compact: boolean;
}

const Ctx = createContext<(AiUi & { state: AiUiState; close: (what: 'dictionary' | 'chat' | 'settings') => void }) | null>(null);

export function AiUiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AiUiState>({
    dictionary: { open: false, word: '', seq: 0 },
    chat: { open: false, preset: null, seq: 0 },
    settingsOpen: false,
    compact: false,
  });

  // Actions only use setState, so they are created once and stay stable for effects.
  const actions = useMemo(() => ({
    openDictionary: (word = '') =>
      setState((s) => ({ ...s, chat: { ...s.chat, open: false }, dictionary: { open: true, word, seq: s.dictionary.seq + 1 } })),
    openChat: (preset?: ChatPreset) =>
      setState((s) => ({ ...s, dictionary: { ...s.dictionary, open: false }, chat: { open: true, preset: preset ?? null, seq: s.chat.seq + 1 } })),
    openSettings: () => setState((s) => ({ ...s, settingsOpen: true })),
    setCompact: (compact: boolean) => setState((s) => (s.compact === compact ? s : { ...s, compact })),
    close: (what: 'dictionary' | 'chat' | 'settings') =>
      setState((s) =>
        what === 'settings'
          ? { ...s, settingsOpen: false }
          : what === 'chat'
            ? { ...s, chat: { ...s.chat, open: false } }
            : { ...s, dictionary: { ...s.dictionary, open: false } },
      ),
  }), []);
  const value = useMemo(() => ({ ...actions, state }), [actions, state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiUi() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAiUi must be used inside AiUiProvider');
  return ctx;
}

/** Call from battle screens: shows the compact header while mounted. */
export function useCompactHeader() {
  const { setCompact } = useAiUi();
  useEffect(() => {
    setCompact(true);
    return () => setCompact(false);
  }, [setCompact]);
}

/** Re-render when saved words change (added from the dictionary). */
export function useMyWordsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((x) => x + 1);
    window.addEventListener('vocab-battle:mywords', on);
    return () => window.removeEventListener('vocab-battle:mywords', on);
  }, []);
  return v;
}

export function notifyMyWordsChanged() {
  window.dispatchEvent(new Event('vocab-battle:mywords'));
}
