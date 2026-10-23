import { trimHistory } from './chatHistory';
import { parseLookup } from './shared';
import { readSse } from './sse';
import {
  checkDistractorItems,
  checkGenerateDeck,
  checkPassage,
  cleanDeck,
  cleanDistractors,
  cleanItems,
  onlyPhrases,
  MAX_EXTRACTED,
  MAX_SUGGESTIONS,
  type DistractorInput,
  type DistractorResult,
  type GenerateDeckInput,
  type GeneratedDeck,
  type GeneratedItem,
} from './tasks';
import { AiError, type AiClient, type Cefr, type ChatRequest, type LookupEntry } from './types';

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('Không kết nối được máy chủ AI. Kiểm tra mạng rồi thử lại.');
  }
  if (!res.ok) throw await toError(res);
  return res;
}

/** Turn an API error (including 429 with retryAfterSeconds) into a message for the player. */
export async function toError(res: Response): Promise<AiError> {
  let data: { error?: string; retryAfterSeconds?: number } = {};
  try {
    if (res.headers.get('content-type')?.includes('json')) data = await res.json();
  } catch {
    // ignore
  }
  const retry = data.retryAfterSeconds ?? (Number(res.headers.get('Retry-After')) || undefined);
  if (data.error) return new AiError(data.error, res.status, retry);
  if (res.status === 429) return new AiError('Bạn gửi quá nhiều yêu cầu, thử lại sau ít phút.', 429, retry);
  if (res.status === 404) {
    return new AiError('Không tìm thấy API AI. Khi chạy local hãy dùng SWA CLI, hoặc nhập API key riêng trong ⚙️ Cài đặt.', 404);
  }
  return new AiError(`Máy chủ AI gặp lỗi (HTTP ${res.status}). Thử lại sau.`, res.status);
}

/** Calls the app's own /api (same origin on Azure Static Web Apps). */
export class ServerAiClient implements AiClient {
  readonly kind = 'server';

  async lookup(word: string, signal?: AbortSignal): Promise<LookupEntry> {
    const res = await post('/api/lookup', { word }, signal);
    const entry = parseLookup(await res.text());
    if (!entry) throw new AiError('Máy chủ trả về dữ liệu không hợp lệ.');
    return entry;
  }

  async chat(req: ChatRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
    const res = await post('/api/chat', { ...req, messages: trimHistory(req.messages) }, signal);

    // Non-streaming fallback (CHAT_STREAMING=false): one JSON reply.
    if (res.headers.get('content-type')?.includes('application/json')) {
      const { reply } = (await res.json()) as { reply: string };
      onDelta(reply);
      return reply;
    }

    // SSE: data: {"delta"} … {"done": true} | {"error"}. If the host buffers, it all arrives at once - still fine.
    let reply = '';
    let error: string | null = null;
    await readSse(res, (data) => {
      const msg = JSON.parse(data) as { delta?: string; error?: string };
      if (msg.delta) {
        reply += msg.delta;
        onDelta(msg.delta);
      } else if (msg.error) {
        error = msg.error;
      }
    });
    if (error) throw new AiError(error);
    return reply;
  }

  // The server validates and cleans these; the client cleans again so a bad response can't break a deck.

  async generateDeck(input: GenerateDeckInput, signal?: AbortSignal): Promise<GeneratedDeck> {
    const checked = checkGenerateDeck(input);
    const res = await post('/api/generate-deck', checked, signal);
    return cleanDeck((await res.json()) as Record<string, unknown>, checked);
  }

  async suggestPhrases(word: string, signal?: AbortSignal): Promise<GeneratedItem[]> {
    const res = await post('/api/suggest-phrases', { word }, signal);
    return cleanItems(((await res.json()) as { items?: unknown }).items, MAX_SUGGESTIONS, onlyPhrases);
  }

  async extractItems(passage: string, level: Cefr, signal?: AbortSignal): Promise<GeneratedItem[]> {
    const res = await post('/api/extract-items', { passage: checkPassage(passage), level }, signal);
    return cleanItems(((await res.json()) as { items?: unknown }).items, MAX_EXTRACTED);
  }

  async generateDistractors(items: DistractorInput[], signal?: AbortSignal): Promise<DistractorResult[]> {
    const checked = checkDistractorItems(items);
    const res = await post('/api/generate-distractors', { items: checked }, signal);
    return cleanDistractors(((await res.json()) as { results?: unknown }).results, checked);
  }
}
