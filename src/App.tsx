import { useState } from 'react';
import { AiUiProvider } from './components/ai/AiContext';
import { AppHeader } from './components/ai/AppHeader';
import { AiPanels } from './components/ai/AiPanels';
import { Menu } from './components/Menu';
import { OfflineGame, type OfflineConfig } from './components/OfflineGame';
import { OnlineGame } from './components/OnlineGame';
import { roomFromSearch } from './net/roomCode';

type Screen = { name: 'menu' } | { name: 'offline'; config: OfflineConfig } | { name: 'online'; room: string | null };

function initialScreen(): Screen {
  const room = roomFromSearch(window.location.search);
  return room ? { name: 'online', room } : { name: 'menu' };
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
    default:
      content = <Menu onOffline={(config) => setScreen({ name: 'offline', config })} onOnline={() => setScreen({ name: 'online', room: null })} />;
  }

  return (
    <AiUiProvider>
      <AppHeader />
      {content}
      <AiPanels />
    </AiUiProvider>
  );
}
