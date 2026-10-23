import { useState } from 'react';
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
      <button type="button" className="icon-btn" aria-label="Cài đặt AI" title="Cài đặt AI" onClick={openSettings}>
        ⚙️
      </button>
    </header>
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
