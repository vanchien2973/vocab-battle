import { useState } from 'react';
import { LOGIN_PROVIDERS, loginUrl, logoutUrl } from '../../auth/auth';
import { useData } from '../../decks/DataContext';
import { useAiUi } from './AiContext';

/** Dictionary search on every screen; battle screens get compact icons instead. */
export function AppHeader() {
  const { state, openDictionary, openChat, openSettings } = useAiUi();
  const [q, setQ] = useState('');

  if (state.compact) {
    return (
      <div className="app-header compact">
        <button type="button" className="icon-btn" aria-label="Tra từ" title="Tra từ" onClick={() => openDictionary()}>
          📖
        </button>
      </div>
    );
  }

  return (
    <header className="app-header">
      <form
        className="lookup-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          openDictionary(q);
        }}
      >
        <input
          className="input"
          type="search"
          value={q}
          maxLength={40}
          placeholder="📖 Tra từ tiếng Anh…"
          aria-label="Tra từ tiếng Anh"
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <button type="button" className="icon-btn" aria-label="Gia sư AI" title="Gia sư AI" onClick={() => openChat()}>
        💬
      </button>
      <button type="button" className="icon-btn" aria-label="Cài đặt" title="Cài đặt" onClick={openSettings}>
        ⚙️
      </button>
      <AuthButton />
    </header>
  );
}

/** Login (GitHub / Microsoft via SWA built-in auth) or the signed-in user with logout. */
function AuthButton() {
  const { user, authLoading } = useData();
  const [open, setOpen] = useState(false);
  if (authLoading) return null;
  if (user) {
    return (
      <a className="icon-btn auth-btn" href={logoutUrl()} title={`Đăng xuất (${user.name})`}>
        👤 <span className="auth-name">{user.name}</span>
      </a>
    );
  }
  return (
    <div className="auth-menu">
      <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Đăng nhập
      </button>
      {open && (
        <div className="auth-pop card" role="menu">
          {LOGIN_PROVIDERS.map((p) => (
            <a key={p.id} role="menuitem" className="btn small" href={loginUrl(p.id)}>
              {p.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** A word that opens the dictionary when tapped. */
export function WordLink({ word, children }: { word: string; children?: React.ReactNode }) {
  const { openDictionary } = useAiUi();
  return (
    <button
      type="button"
      className="word-link"
      title={`Tra "${word}"`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openDictionary(word);
      }}
    >
      {children ?? word}
    </button>
  );
}
