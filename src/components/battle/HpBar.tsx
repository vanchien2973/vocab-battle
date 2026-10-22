import { MAX_HP } from '../../game/engine';
import type { PlayerState } from '../../game/types';

export function HpBar({ player, label, small }: { player: PlayerState; label?: string; small?: boolean }) {
  const pct = (player.hp / MAX_HP) * 100;
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low';
  return (
    <div className={`hp ${small ? 'small' : ''}`}>
      <div className="hp-top">
        <span className="hp-name">
          {player.name}
          {label && <span className="muted"> · {label}</span>}
        </span>
        {player.combo >= 2 && <span className="combo">🔥 x{player.combo}</span>}
        <span className="hp-num">{player.hp}</span>
      </div>
      <div className="hp-track" role="meter" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={player.hp} aria-label={`HP ${player.name}`}>
        <div className={`hp-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
