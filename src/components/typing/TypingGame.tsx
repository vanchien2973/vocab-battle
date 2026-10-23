import { useState } from 'react';
import type { BotLevel } from '../../controllers/bot';
import type { BattleItem } from '../../data/words';
import { loadSelection, savePracticeWords, saveSelection } from '../../storage/selection';
import { recordTypingScore, typingScoreKey } from '../../storage/typingScores';
import { CONTENT_KINDS, CONTENT_LABELS, type ContentKind } from '../../typing/types';
import { ItemPicker } from '../prepare/ItemPicker';
import { TypingPlay, type TypingResultData, type TypingRule } from './TypingPlay';
import { TypingResult } from './TypingResult';
import { useTypingResults } from './useTypingResults';

const CONTENT_HINTS: Record<ContentKind, string> = {
  copy: 'Thẻ hiện từ tiếng Anh, gõ y hệt (luyện chính tả).',
  meaning: 'Thẻ hiện nghĩa tiếng Việt, gõ từ/cụm từ tiếng Anh.',
  listen: 'Thẻ ẩn chữ và đọc to; Tab hoặc chạm thẻ để nghe lại.',
  cloze: 'Thẻ hiện câu ví dụ có chỗ trống, gõ phần bị che.',
};

export interface TypingConfig {
  mode: 'solo' | 'bot';
  botLevel: BotLevel;
  content: ContentKind;
  rule: TypingRule;
}

interface Props {
  onMenu: () => void;
  onOnline: () => void;
  /** Review the given items as flashcards. */
  onReview?: (items: BattleItem[]) => void;
}

const deckLabelOf = (items: readonly BattleItem[]) => {
  const decks = new Set(items.map((i) => i.deckId ?? 'builtin'));
  return decks.size === 1 && decks.has('builtin') ? 'Bộ có sẵn' : `${items.length} mục`;
};

/** "Luyện Gõ": settings → choose words → play → result. */
export function TypingGame({ onMenu, onOnline, onReview }: Props) {
  const saveResults = useTypingResults();
  const [stage, setStage] = useState<'setup' | 'pick' | 'play' | 'result'>('setup');
  const [config, setConfig] = useState<TypingConfig>({ mode: 'solo', botLevel: 'normal', content: 'meaning', rule: 'hearts' });
  const [selection, setSelection] = useState(loadSelection);
  const [items, setItems] = useState<BattleItem[]>([]);
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 31) >>> 0);
  const [result, setResult] = useState<{ data: TypingResultData; best: { score: number; isNew: boolean } | null } | null>(null);

  if (stage === 'setup') {
    return (
      <div className="menu typing-setup">
        <h1 className="logo">
          ⌨️ Luyện <span>Gõ</span>
        </h1>
        <p className="muted tagline">Thẻ từ rơi xuống – gõ đúng để bắn hạ trước khi chạm đáy.</p>
        <section className="card form-grid">
          <h3>Chế độ</h3>
          <div className="chips" role="radiogroup" aria-label="Chế độ">
            {(
              [
                ['solo', '🎯 Một mình'],
                ['bot', '🤖 Đấu Bot'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} type="button" role="radio" aria-checked={config.mode === m} className={`chip ${config.mode === m ? 'on' : ''}`} onClick={() => setConfig({ ...config, mode: m })}>
                {label}
              </button>
            ))}
            <button type="button" className="chip" onClick={onOnline}>
              🌐 Online 1v1
            </button>
          </div>
          {config.mode === 'bot' && (
            <>
              <div className="chips" role="radiogroup" aria-label="Độ khó Bot">
                {(
                  [
                    ['easy', 'Dễ · 22 WPM'],
                    ['normal', 'Thường · 38 WPM'],
                    ['hard', 'Khó · 58 WPM'],
                  ] as const
                ).map(([lv, label]) => (
                  <button key={lv} type="button" role="radio" aria-checked={config.botLevel === lv} className={`chip ${config.botLevel === lv ? 'on' : ''}`} onClick={() => setConfig({ ...config, botLevel: lv })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="chips" role="radiogroup" aria-label="Luật">
                {(
                  [
                    ['hearts', '❤️ Hết tim thì thua'],
                    ['race', '🏁 Đua mốc 20'],
                  ] as const
                ).map(([r, label]) => (
                  <button key={r} type="button" role="radio" aria-checked={config.rule === r} className={`chip ${config.rule === r ? 'on' : ''}`} onClick={() => setConfig({ ...config, rule: r })}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="muted small">2 người trên 1 bàn phím không được hỗ trợ – hãy chơi Online 1v1 với bạn.</p>

          <h3>Kiểu nội dung</h3>
          <div className="chips" role="radiogroup" aria-label="Kiểu nội dung">
            {CONTENT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={config.content === k} className={`chip ${config.content === k ? 'on' : ''}`} onClick={() => setConfig({ ...config, content: k })}>
                {CONTENT_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="muted small">{CONTENT_HINTS[config.content]}</p>
          <details className="howto">
            <summary>Cách chơi</summary>
            <ul>
              <li>Gõ ký tự đầu để ngắm thẻ gần đáy nhất, gõ hết để bắn hạ. Esc bỏ ngắm, Backspace xoá ký tự.</li>
              <li>Thẻ chạm vạch đáy: mất 1 tim (có 3 tim). Gõ sai mất combo.</li>
              <li>Giữ phím ? 1 giây (hoặc bấm 💡) để lộ ký tự kế tiếp, bị trừ điểm.</li>
              <li>20 mốc: qua mỗi mốc thẻ rơi nhanh hơn và nhiều hơn. Đấu: combo 5/10 gửi thẻ tấn công sang đối thủ.</li>
              <li>Hãy tắt bộ gõ tiếng Việt (Telex/VNI) trước khi chơi.</li>
            </ul>
          </details>
        </section>
        <div className="actions-row">
          <button type="button" className="btn ghost" onClick={onMenu}>
            ← Menu
          </button>
          <button type="button" className="btn primary big" onClick={() => setStage('pick')}>
            Chọn từ →
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'pick') {
    return (
      <ItemPicker
        selection={selection}
        onChange={setSelection}
        hideKinds
        onBack={() => setStage('setup')}
        title={`Luyện Gõ · ${CONTENT_LABELS[config.content]}${config.mode === 'bot' ? ' · đấu Bot' : ''}`}
        onNext={(chosen) => {
          saveSelection(selection);
          savePracticeWords(chosen);
          setItems(chosen);
          setSeed((Math.random() * 2 ** 31) >>> 0);
          setStage('play');
        }}
      />
    );
  }

  if (stage === 'play') {
    return (
      <TypingPlay
        key={seed}
        items={items}
        content={config.content}
        seed={seed}
        rule={config.mode === 'bot' ? config.rule : 'hearts'}
        mode={config.mode}
        botLevel={config.botLevel}
        deckLabel={deckLabelOf(items)}
        onFinish={(data) => {
          const best = config.mode === 'solo' && data.result !== 'quit' ? recordTypingScore(typingScoreKey(items, config.content), data.score, data.wpm) : null;
          setResult({ data, best });
          setStage('result');
          saveResults(data);
        }}
      />
    );
  }

  return (
    <TypingResult data={result!.data} best={result!.best} onReview={onReview}>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          setSeed((Math.random() * 2 ** 31) >>> 0);
          setStage('play');
        }}
      >
        🔁 Chơi lại
      </button>
      <button type="button" className="btn" onClick={() => setStage('pick')}>
        Đổi bộ từ
      </button>
      <button type="button" className="btn ghost" onClick={onMenu}>
        Menu
      </button>
    </TypingResult>
  );
}
