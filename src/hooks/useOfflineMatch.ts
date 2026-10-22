import { useCallback, useEffect, useRef, useState } from 'react';
import { createBotController, type BotLevel } from '../controllers/bot';
import { ALL_WORDS, wordsFromIds } from '../data/words';
import { Match } from '../game/match';
import type { GameState, PlayerId } from '../game/types';

export interface OfflineMatchConfig {
  names: Record<PlayerId, string>;
  /** Present for "vs Bot": the bot plays p2. */
  botLevel?: BotLevel;
}

/** Runs a Match locally (Local 2P or vs Bot) for the lifetime of the component. */
export function useOfflineMatch(config: OfflineMatchConfig, wordIds: string[]) {
  const [state, setState] = useState<GameState | null>(null);
  const matchRef = useRef<Match | null>(null);

  useEffect(() => {
    const match = new Match({ names: config.names, selected: wordsFromIds(wordIds), pool: ALL_WORDS });
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

  return { state, submit };
}
