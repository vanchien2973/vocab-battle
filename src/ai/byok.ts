import { readJSON, writeJSON } from '../storage/safeStorage';

export type ByokProvider = 'openai' | 'anthropic';

export interface ByokSettings {
  provider: ByokProvider;
  apiKey: string;
  model: string;
}

/** Suggested models (see README for why): cheapest current text model of each provider. */
export const DEFAULT_MODELS: Record<ByokProvider, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
};

const KEY = 'vocab-battle.byok.v1';

/** The player's own API key (stored only in this browser). Null when not set. */
export function loadByok(): ByokSettings | null {
  const s = readJSON<Partial<ByokSettings>>(KEY, {});
  if ((s.provider !== 'openai' && s.provider !== 'anthropic') || !s.apiKey?.trim()) return null;
  return { provider: s.provider, apiKey: s.apiKey.trim(), model: s.model?.trim() || DEFAULT_MODELS[s.provider] };
}

export function saveByok(settings: ByokSettings): void {
  writeJSON(KEY, settings);
  window.dispatchEvent(new Event('vocab-battle:byok'));
}

export function clearByok(): void {
  writeJSON(KEY, {});
  window.dispatchEvent(new Event('vocab-battle:byok'));
}
