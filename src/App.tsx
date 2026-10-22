import { useState } from 'react';
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

  switch (screen.name) {
    case 'offline':
      return <OfflineGame config={screen.config} onMenu={toMenu} />;
    case 'online':
      return <OnlineGame initialRoom={screen.room} onMenu={toMenu} />;
    default:
      return <Menu onOffline={(config) => setScreen({ name: 'offline', config })} onOnline={() => setScreen({ name: 'online', room: null })} />;
  }
}
