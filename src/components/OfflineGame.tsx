import { useEffect, useState } from 'react';
import type { BotLevel } from '../controllers/bot';
import type { BattleItem } from '../data/words';
import { useData } from '../decks/DataContext';
import type { GameState, PlayerId, QuestionKind } from '../game/types';
import { useCountdown } from '../hooks/useCountdown';
import { useOfflineMatch, type OfflineMatchConfig } from '../hooks/useOfflineMatch';
import { COUNTDOWN_SECONDS } from '../net/session';
import { loadSelection, savePracticeWords, saveSelection } from '../storage/selection';
import { applyBattleReviews, battleReviews } from '../study/battleProgress';
import { PlayerView } from './battle/PlayerView';
import { CountdownOverlay } from './prepare/CountdownOverlay';
import { ItemPicker } from './prepare/ItemPicker';
import { WordPreview } from './prepare/WordPreview';
import { ResultScreen } from './ResultScreen';

export type OfflineConfig =
  | { mode: 'local'; names: { p1: string; p2: string } }
  | { mode: 'bot'; name: string; botLevel: BotLevel };

const BOT_NAMES: Record<BotLevel, string> = { easy: 'Bot Dễ', normal: 'Bot Thường', hard: 'Bot Khó' };

function matchConfig(c: OfflineConfig): OfflineMatchConfig {
  return c.mode === 'local'
    ? { names: c.names }
    : { names: { p1: c.name, p2: BOT_NAMES[c.botLevel] }, botLevel: c.botLevel };
}

/** Local 2P and vs Bot: pick words → preview → battle → result. */
export function OfflineGame({ config, onMenu }: { config: OfflineConfig; onMenu: () => void }) {
  const [stage, setStage] = useState<'pick' | 'preview' | 'battle'>('pick');
  const [selection, setSelection] = useState(loadSelection);
  const [items, setItems] = useState<BattleItem[]>([]);
  const [kinds, setKinds] = useState<QuestionKind[]>(selection.kinds);
  const [ready, setReady] = useState({ p1: false, p2: false });
  const [battleKey, setBattleKey] = useState(0);
  const countdown = useCountdown(COUNTDOWN_SECONDS, () => setStage('battle'));
  const isLocal = config.mode === 'local';

  const toPreview = (chosen: BattleItem[], chosenKinds: QuestionKind[]) => {
    saveSelection(selection);
    savePracticeWords(chosen);
    setItems(chosen);
    setKinds(chosenKinds);
    setReady({ p1: false, p2: false });
    setStage('preview');
  };

  const toggleReady = (id: 'p1' | 'p2') => {
    const next = { ...ready, [id]: !ready[id] };
    setReady(next);
    if (next.p1 && (next.p2 || !isLocal)) countdown.start();
  };

  if (stage === 'pick') {
    return (
      <ItemPicker
        selection={selection}
        onChange={setSelection}
        onNext={toPreview}
        onBack={onMenu}
        title={isLocal ? 'Hai người dùng chung một bộ từ.' : `Đấu với ${BOT_NAMES[config.botLevel]}.`}
      />
    );
  }

  if (stage === 'preview') {
    const locked = countdown.value !== null;
    return (
      <>
        <WordPreview words={items} onBack={locked ? undefined : () => setStage('pick')}>
          {isLocal ? (
            (['p1', 'p2'] as const).map((id) => (
              <button key={id} type="button" className={`btn ${ready[id] ? 'ready' : 'primary'}`} disabled={locked} onClick={() => toggleReady(id)}>
                {ready[id] ? `✓ ${config.names[id]} sẵn sàng` : `${config.names[id]}: Sẵn sàng`}
              </button>
            ))
          ) : (
            <button type="button" className="btn primary" disabled={locked} onClick={() => toggleReady('p1')}>
              Sẵn sàng
            </button>
          )}
        </WordPreview>
        <CountdownOverlay value={countdown.value} />
      </>
    );
  }

  return (
    <OfflineBattle
      key={battleKey}
      config={config}
      items={items}
      kinds={kinds}
      onReplay={() => setBattleKey((k) => k + 1)}
      onChangeWords={() => setStage('pick')}
      onMenu={onMenu}
    />
  );
}

interface BattleProps {
  config: OfflineConfig;
  items: BattleItem[];
  kinds: QuestionKind[];
  onReplay: () => void;
  onChangeWords: () => void;
  onMenu: () => void;
}

function OfflineBattle({ config, items: words, kinds, onReplay, onChangeWords, onMenu }: BattleProps) {
  const [cfg] = useState(() => matchConfig(config));
  const { state, submit, skipReveal } = useOfflineMatch(cfg, words, kinds);
  // The bottom player (p1) owns this device: their results update FSRS for items from their decks.
  useBattleProgress(state?.phase === 'over' ? state : null, 'p1', words);
  const showResult = useDelayedFlag(state?.phase === 'over', 1200);
  if (!state) return null;

  const isLocal = config.mode === 'local';
  if (showResult) {
    return (
      <ResultScreen state={state} mode={config.mode} viewers={isLocal ? ['p1', 'p2'] : ['p1']} words={words}>
        <button type="button" className="btn primary" onClick={onReplay}>
          🔁 Chơi lại
        </button>
        <button type="button" className="btn" onClick={onChangeWords}>
          Đổi bộ từ
        </button>
        <button type="button" className="btn ghost" onClick={onMenu}>
          Menu
        </button>
      </ResultScreen>
    );
  }

  const quit = (
    <button type="button" className="btn ghost quit" onClick={onMenu} aria-label="Thoát trận">
      ✕
    </button>
  );

  if (isLocal) {
    return (
      <div className="split">
        <div className="half top">
          <PlayerView state={state} me="p2" keys={['7', '8', '9', '0']} onAnswer={(q, i, ms) => submit('p2', q, i, ms)} onSkip={skipReveal} />
        </div>
        <div className="half">
          <PlayerView state={state} me="p1" onAnswer={(q, i, ms) => submit('p1', q, i, ms)} onSkip={skipReveal} />
        </div>
        {quit}
      </div>
    );
  }

  return (
    <div className="solo">
      <PlayerView state={state} me="p1" opponentLabel="Bot" onAnswer={(q, i, ms) => submit('p1', q, i, ms)} onSkip={skipReveal} />
      {quit}
    </div>
  );
}

/** True once `flag` has stayed true for `ms` (lets players see the final hit). */
export function useDelayedFlag(flag: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return on;
}

const applied = new WeakSet<GameState>();

/** Once per finished match: wrong items → Again, right items → Good on the player's EN → VI cards. */
export function useBattleProgress(finished: GameState | null, player: PlayerId, items: readonly BattleItem[]) {
  const data = useData();
  useEffect(() => {
    if (!finished || applied.has(finished)) return;
    applied.add(finished);
    const reviews = battleReviews(finished, player, items);
    if (reviews.length) void applyBattleReviews(reviews, data.loadProgress, data.queue).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
}
