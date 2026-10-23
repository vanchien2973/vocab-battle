import { useCallback, useEffect, useRef, useState } from 'react';
import { createBotController, type BotLevel } from '../controllers/bot';
import { BUILTIN_ITEMS, type BattleItem } from '../data/words';
import { Match } from '../game/match';
import { battlePool } from '../game/questions';
import type { GameState, PlayerId, QuestionKind } from '../game/types';

export interface OfflineMatchConfig {
  names: Record<PlayerId, string>;
  /** Present for "vs Bot": the bot plays p2. */
  botLevel?: BotLevel;
}

/** Runs a Match locally (Local 2P or vs Bot) for the lifetime of the component. */
export function useOfflineMatch(config: OfflineMatchConfig, words: BattleItem[], kinds: QuestionKind[]) {
  const [state, setState] = useState<GameState | null>(null);
  const matchRef = useRef<Match | null>(null);

  useEffect(() => {
    const match = new Match({ names: config.names, selected: words, pool: battlePool(BUILTIN_ITEMS, words), kinds });
    matchRef.current = match;
    const unsubscribe = match.subscribe(setState);
    const detachBot = config.botLevel ? createBotController(config.botLevel).attach(match, 'p2') : undefined;
    match.start();
    return () => {
      unsubscribe();
      detachBot?.();
      match.stop();
    };
    // A new match is started by remounting the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback((playerId: PlayerId, questionId: string, answerIndex: number, ms: number) => {
    matchRef.current?.submit(playerId, questionId, answerIndex, ms);
  }, []);

  const skipReveal = useCallback(() => matchRef.current?.skipReveal(), []);

  return { state, submit, skipReveal };
}
