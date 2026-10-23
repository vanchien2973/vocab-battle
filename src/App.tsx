import { lazy, Suspense, useState } from 'react';
import { AiUiProvider } from './components/ai/AiContext';
import { AiPanels } from './components/ai/AiPanels';
import { AppHeader } from './components/ai/AppHeader';
import type { SharedSource } from './components/decks/SharedDeckView';
import { Menu } from './components/Menu';
import { OfflineGame, type OfflineConfig } from './components/OfflineGame';
import { OnlineGame } from './components/OnlineGame';
import { DataProvider, useData } from './decks/DataContext';
import { sharedFromSearch } from './decks/sharedSearch';
import { roomFromSearch } from './net/roomCode';

// Deck management and study screens load on first use.
const DecksPage = lazy(() => import('./components/decks/DecksPage').then((m) => ({ default: m.DecksPage })));
const DeckEditor = lazy(() => import('./components/decks/DeckEditor').then((m) => ({ default: m.DeckEditor })));
const SharedDeckView = lazy(() => import('./components/decks/SharedDeckView').then((m) => ({ default: m.SharedDeckView })));
const StudyScreen = lazy(() => import('./components/study/StudyScreen').then((m) => ({ default: m.StudyScreen })));
const TypingGame = lazy(() => import('./components/typing/TypingGame').then((m) => ({ default: m.TypingGame })));
const SyncPrompt = lazy(() => import('./components/decks/DeckDialogs').then((m) => ({ default: m.SyncPrompt })));

export type Screen =
  | { name: 'menu' }
  | { name: 'offline'; config: OfflineConfig }
  | { name: 'online'; room: string | null }
  | { name: 'decks' }
  | { name: 'deck'; id: string }
  | { name: 'study'; deckIds: string[] | null; back: Screen }
  | { name: 'shared'; source: SharedSource }
  | { name: 'typing' };

function initialScreen(): Screen {
  const room = roomFromSearch(window.location.search);
  if (room) return { name: 'online', room };
  const shared = sharedFromSearch(window.location.search);
  return shared ? { name: 'shared', source: shared } : { name: 'menu' };
}

/** Drop ?share= / ?deck= once handled so a reload does not reopen it. */
function clearSearch() {
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const toMenu = () => setScreen({ name: 'menu' });

  let content;
  switch (screen.name) {
    case 'offline':
      content = <OfflineGame config={screen.config} onMenu={toMenu} />;
      break;
    case 'online':
      content = <OnlineGame initialRoom={screen.room} onMenu={toMenu} />;
      break;
    case 'decks':
      content = <DecksPage onBack={toMenu} onOpen={(id) => setScreen({ name: 'deck', id })} onStudy={(deckIds) => setScreen({ name: 'study', deckIds, back: screen })} />;
      break;
    case 'deck':
      content = (
        <DeckEditor key={screen.id} deckId={screen.id} onBack={() => setScreen({ name: 'decks' })} onStudy={(id) => setScreen({ name: 'study', deckIds: [id], back: screen })} />
      );
      break;
    case 'study':
      content = <StudyScreen deckIds={screen.deckIds} onBack={() => setScreen(screen.back)} />;
      break;
    case 'typing':
      content = <TypingGame onMenu={toMenu} onOnline={() => setScreen({ name: 'online', room: null })} />;
      break;
    case 'shared':
      content = (
        <SharedDeckView
          source={screen.source}
          onClose={() => {
            clearSearch();
            toMenu();
          }}
          onSaved={(id) => {
            clearSearch();
            setScreen({ name: 'deck', id });
          }}
        />
      );
      break;
    default:
      content = (
        <Menu
          onOffline={(config) => setScreen({ name: 'offline', config })}
          onOnline={() => setScreen({ name: 'online', room: null })}
          onDecks={() => setScreen({ name: 'decks' })}
          onStudy={() => setScreen({ name: 'study', deckIds: null, back: { name: 'menu' } })}
          onTyping={() => setScreen({ name: 'typing' })}
        />
      );
  }

  return (
    <DataProvider>
      <AiUiProvider>
        <AppHeader />
        <Suspense fallback={<p className="muted loading center">⏳ Đang tải…</p>}>
          {content}
          <SyncGate />
        </Suspense>
        <AiPanels />
      </AiUiProvider>
    </DataProvider>
  );
}

/** The sync dialog (and its chunk) only loads when there is something to sync. */
function SyncGate() {
  return useData().syncOffer === null ? null : <SyncPrompt />;
}
