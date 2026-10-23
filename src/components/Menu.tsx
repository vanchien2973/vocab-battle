import { useState } from 'react';
import type { BotLevel } from '../controllers/bot';
import { loadHighScores } from '../storage/highScore';
import { loadName, saveName } from '../storage/selection';
import type { OfflineConfig } from './OfflineGame';

interface Props {
  onOffline: (config: OfflineConfig) => void;
  onOnline: () => void;
  onDecks: () => void;
  onStudy: () => void;
}

export function Menu({ onOffline, onOnline, onDecks, onStudy }: Props) {
  const [mode, setMode] = useState<'local' | 'bot' | null>(null);
  const [name, setName] = useState(loadName);
  const [name2, setName2] = useState('');
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  const scores = loadHighScores();

  const start = () => {
    const p1 = name.trim() || 'Người chơi 1';
    saveName(name.trim());
    if (mode === 'local') onOffline({ mode: 'local', names: { p1, p2: name2.trim() || 'Người chơi 2' } });
    else onOffline({ mode: 'bot', name: name.trim() || 'Bạn', botLevel });
  };

  return (
    <div className="menu">
      <h1 className="logo">
        ⚔️ Vocab <span>Battle</span>
      </h1>
      <p className="muted tagline">Đấu từ vựng tiếng Anh – trả lời đúng và nhanh hơn để hạ gục đối thủ!</p>

      {mode === null ? (
        <div className="menu-buttons">
          <button type="button" className="btn big" onClick={() => setMode('local')}>
            👥 2 người · 1 máy
          </button>
          <button type="button" className="btn big" onClick={() => setMode('bot')}>
            🤖 Đấu với Bot
          </button>
          <button type="button" className="btn big primary" onClick={onOnline}>
            🌐 Online 1v1
          </button>
          <div className="menu-row">
            <button type="button" className="btn big" onClick={onDecks}>
              📚 Bộ từ của tôi
            </button>
            <button type="button" className="btn big" onClick={onStudy}>
              🧠 Ôn hôm nay
            </button>
          </div>
        </div>
      ) : (
        <form
          className="setup card"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <h2>{mode === 'local' ? '👥 2 người · 1 máy' : '🤖 Đấu với Bot'}</h2>
          <label>
            {mode === 'local' ? 'Người chơi 1 (phía dưới)' : 'Tên của bạn'}
            <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Nhập tên" />
          </label>
          {mode === 'local' ? (
            <label>
              Người chơi 2 (phía trên)
              <input className="input" value={name2} maxLength={20} onChange={(e) => setName2(e.target.value)} placeholder="Nhập tên" />
            </label>
          ) : (
            <div className="chips" role="radiogroup" aria-label="Độ khó">
              {(
                [
                  ['easy', 'Dễ'],
                  ['normal', 'Thường'],
                  ['hard', 'Khó'],
                ] as const
              ).map(([lv, label]) => (
                <button key={lv} type="button" role="radio" aria-checked={botLevel === lv} className={`chip ${botLevel === lv ? 'on' : ''}`} onClick={() => setBotLevel(lv)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setMode(null)}>
              ← Quay lại
            </button>
            <button type="submit" className="btn primary">
              Chọn từ vựng →
            </button>
          </div>
        </form>
      )}

      <section className="scores card">
        <h2>🏆 Kỷ lục</h2>
        <dl>
          <dt>2 người</dt>
          <dd>{scores.best.local}</dd>
          <dt>Đấu Bot</dt>
          <dd>{scores.best.bot}</dd>
          <dt>Online</dt>
          <dd>{scores.best.online}</dd>
          <dt>Combo dài nhất</dt>
          <dd>{scores.bestCombo}</dd>
        </dl>
      </section>

      <details className="howto card">
        <summary>Cách chơi</summary>
        <ul>
          <li>Chọn bộ từ (tối thiểu 10), xem trước rồi bấm Sẵn sàng.</li>
          <li>Mỗi lượt có 1 từ tiếng Anh và 4 nghĩa tiếng Việt, 10 giây để trả lời.</li>
          <li>Ai đúng và nhanh hơn sẽ gây sát thương. Đúng liên tiếp tạo combo, sát thương tăng dần.</li>
          <li>Mỗi bên có 100 HP – hết HP là thua.</li>
          <li>Bàn phím: người dưới phím 1–4, người trên phím 7–0.</li>
        </ul>
      </details>
    </div>
  );
}
