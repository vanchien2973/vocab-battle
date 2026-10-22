import type { MatchLike } from '../game/match';
import type { PlayerId } from '../game/types';

/**
 * Something that plays one side of a match: a human through the UI, the bot, or a remote
 * peer. Controllers react to match state and call `match.submit`. Returns a detach function.
 */
export interface PlayerController {
  attach(match: MatchLike, playerId: PlayerId): () => void;
}
