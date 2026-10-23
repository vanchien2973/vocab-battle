import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerAiClient } from './serverAiClient';
import { createSseParser } from './sse';
import { AiError } from './types';

afterEach(() => vi.unstubAllGlobals());

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
}

const req = { mode: 'freeTalk' as const, messages: [{ role: 'user' as const, content: 'hi' }] };

describe('sse parser', () => {
  it('handles events split across chunks', () => {
    const got: string[] = [];
    const p = createSseParser((d) => got.push(d));
    p.push('data: {"delta":"He');
    p.push('l"}\n\ndata: {"delta":"lo"}\r\n\r\nda');
    p.push('ta: {"done":true}');
    p.end();
    expect(got).toEqual(['{"delta":"Hel"}', '{"delta":"lo"}', '{"done":true}']);
  });
});

describe('ServerAiClient.chat', () => {
  it('streams deltas from SSE', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(streamOf(['data: {"delta":"Xin "}\n\n', 'data: {"delta":"chào"}\n\ndata: {"done":true}\n\n']), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const reply = await new ServerAiClient().chat(req, (d) => deltas.push(d));
    expect(reply).toBe('Xin chào');
    expect(deltas).toEqual(['Xin ', 'chào']);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('system');
    expect(body).not.toHaveProperty('model');
  });

  it('accepts a one-shot JSON reply (non-streaming fallback)', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ reply: 'Hello!' }));
    const deltas: string[] = [];
    expect(await new ServerAiClient().chat(req, (d) => deltas.push(d))).toBe('Hello!');
    expect(deltas).toEqual(['Hello!']);
  });

  it('surfaces stream errors', async () => {
    vi.stubGlobal('fetch', async () => new Response(streamOf(['data: {"error":"Claude gặp lỗi"}\n\n']), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(new ServerAiClient().chat(req, () => {})).rejects.toThrow('Claude gặp lỗi');
  });

  it('turns 429 into a readable error with retry time', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Bạn gửi quá nhanh. Đợi 12 giây rồi thử lại.', retryAfterSeconds: 12 }, { status: 429 }));
    const err = (await new ServerAiClient().lookup('resilient').catch((e) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(12);
    expect(err.message).toContain('12 giây');
  });
});
