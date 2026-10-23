import { lazy, Suspense } from 'react';
import { useAiUi } from './AiContext';

// Loaded on first use, so markdown, schema validation and AI clients stay out of the main bundle.
const DictionaryPanel = lazy(() => import('./DictionaryPanel').then((m) => ({ default: m.DictionaryPanel })));
const ChatPanel = lazy(() => import('./ChatPanel').then((m) => ({ default: m.ChatPanel })));
const SettingsDialog = lazy(() => import('./SettingsDialog').then((m) => ({ default: m.SettingsDialog })));

export function AiPanels() {
  const { state } = useAiUi();
  return (
    <Suspense fallback={<div className="sheet-backdrop" />}>
      {state.dictionary.open && <DictionaryPanel />}
      {(state.chat.open || state.chat.seq > 0) && <ChatPanel />}
      {state.settingsOpen && <SettingsDialog />}
    </Suspense>
  );
}
