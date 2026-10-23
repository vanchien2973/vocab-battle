import type Anthropic from '@anthropic-ai/sdk';
import type { ByokSettings } from './byok';
import { prepareChat } from './chatHistory';
import { lookupSchema, normalizeWord, parseLookup, prompts } from './shared';
import { readSse } from './sse';
import { AiError, type AiClient, type ChatRequest, type LookupEntry } from './types';

// Same defaults as the server (AI_LOOKUP_MAX_TOKENS / AI_CHAT_MAX_TOKENS).
const LOOKUP_MAX_TOKENS = 1500;
const CHAT_MAX_TOKENS = 800;

/**
 * BYOK fallback: calls OpenAI or Anthropic straight from the browser with the player's own key,
 * using the same system prompts and lookup schema as the server.
 */
export class DirectAiClient implements AiClient {
  readonly kind = 'direct';
  private anthropic: Promise<Anthropic> | null = null;

  constructor(private readonly settings: ByokSettings) {}

  async lookup(word: string, signal?: AbortSignal): Promise<LookupEntry> {
    const w = normalizeWord(word);
    if (!w) throw new AiError('Từ cần tra phải là chữ cái tiếng Anh, tối đa 40 ký tự.', 400);
    // Same policy as the server: retry once when the output does not match the schema.
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = this.settings.provider === 'anthropic' ? await this.anthropicLookup(w, signal) : await this.openAiLookup(w, signal);
      const entry = parseLookup(text);
      if (entry) return entry;
    }
    throw new AiError('AI trả về dữ liệu không hợp lệ, thử lại sau.');
  }

  chat(req: ChatRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
    const { system, messages } = prepareChat(req);
    return this.settings.provider === 'anthropic'
      ? this.anthropicChat(system, messages, onDelta, signal)
      : this.openAiChat(system, messages, onDelta, signal);
  }

  // ---------- OpenAI (Responses API) ----------

  private async openAi(body: object, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.settings.apiKey}` },
        body: JSON.stringify({ model: this.settings.model, reasoning: { effort: 'none' }, store: false, ...body }),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AiError('Không kết nối được OpenAI.');
    }
    if (!res.ok) throw providerError('OpenAI', res.status);
    return res;
  }

  private async openAiLookup(word: string, signal?: AbortSignal): Promise<string> {
    const res = await this.openAi(
      {
        instructions: prompts.lookupSystem,
        input: [{ role: 'user', content: prompts.lookupUser.replace('{word}', word) }],
        max_output_tokens: LOOKUP_MAX_TOKENS,
        text: { format: { type: 'json_schema', name: 'dictionary_entry', strict: true, schema: lookupSchema } },
      },
      signal,
    );
    const data = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
    let text = '';
    for (const item of data.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') throw new AiError('AI từ chối tra từ này.', 422);
        if (part.type === 'output_text') text += part.text ?? '';
      }
    }
    return text;
  }

  private async openAiChat(system: string, messages: object[], onDelta: (t: string) => void, signal?: AbortSignal) {
    const res = await this.openAi({ instructions: system, input: messages, max_output_tokens: CHAT_MAX_TOKENS, stream: true }, signal);
    let reply = '';
    let failed = false;
    await readSse(res, (data) => {
      if (data === '[DONE]') return;
      const evt = JSON.parse(data) as { type: string; delta?: string };
      if (evt.type === 'response.output_text.delta' && evt.delta) {
        reply += evt.delta;
        onDelta(evt.delta);
      } else if (evt.type === 'response.failed' || evt.type === 'error') {
        failed = true;
      }
    });
    if (failed) throw new AiError('OpenAI gặp lỗi khi trả lời, thử lại sau.');
    return reply;
  }

  // ---------- Anthropic (official SDK, browser mode) ----------

  private client(): Promise<Anthropic> {
    // Loaded on demand so players who never use BYOK don't download the SDK.
    this.anthropic ??= import('@anthropic-ai/sdk').then(
      // dangerouslyAllowBrowser sends the anthropic-dangerous-direct-browser-access header.
      ({ default: Sdk }) => new Sdk({ apiKey: this.settings.apiKey, dangerouslyAllowBrowser: true }),
    );
    return this.anthropic;
  }

  private async anthropicLookup(word: string, signal?: AbortSignal): Promise<string> {
    const client = await this.client();
    const msg = await withAnthropicErrors(() =>
      client.messages.create(
        {
          model: this.settings.model,
          max_tokens: LOOKUP_MAX_TOKENS,
          system: prompts.lookupSystem,
          messages: [{ role: 'user', content: prompts.lookupUser.replace('{word}', word) }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: lookupSchema } },
        },
        { signal },
      ),
    );
    if (msg.stop_reason === 'refusal') throw new AiError('AI từ chối tra từ này.', 422);
    // Read blocks by type: the response may start with (empty) thinking blocks.
    return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }

  private async anthropicChat(system: string, messages: Anthropic.MessageParam[], onDelta: (t: string) => void, signal?: AbortSignal) {
    const client = await this.client();
    return withAnthropicErrors(async () => {
      const stream = client.messages.stream(
        { model: this.settings.model, max_tokens: CHAT_MAX_TOKENS, system, messages, output_config: { effort: 'low' } },
        { signal },
      );
      let reply = '';
      stream.on('text', (t) => {
        reply += t;
        onDelta(t);
      });
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new AiError('AI từ chối trả lời yêu cầu này.', 422);
      return reply;
    });
  }
}

function providerError(provider: string, status: number): AiError {
  if (status === 401 || status === 403) return new AiError(`API key ${provider} không hợp lệ. Kiểm tra lại trong ⚙️ Cài đặt.`, status);
  if (status === 429) return new AiError(`${provider} đang giới hạn tần suất hoặc tài khoản hết hạn mức.`, 429);
  if (status === 404) return new AiError(`Model không tồn tại hoặc key không có quyền dùng model này.`, 404);
  return new AiError(`${provider} gặp lỗi (HTTP ${status}).`, status);
}

async function withAnthropicErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiError || (e as Error).name === 'AbortError') throw e;
    const { default: Sdk } = await import('@anthropic-ai/sdk');
    if (e instanceof Sdk.APIUserAbortError) throw e;
    if (e instanceof Sdk.APIConnectionError) throw new AiError('Không kết nối được Anthropic.');
    if (e instanceof Sdk.APIError && e.status) throw providerError('Anthropic', e.status);
    throw e;
  }
}
