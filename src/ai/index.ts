import { loadByok } from './byok';
import { DirectAiClient } from './directAiClient';
import { ServerAiClient } from './serverAiClient';
import type { AiClient } from './types';

const server = new ServerAiClient();

/** BYOK key set in Settings → call the provider directly; otherwise use the app's API. */
export function getAiClient(): AiClient {
  const byok = loadByok();
  return byok ? new DirectAiClient(byok) : server;
}
