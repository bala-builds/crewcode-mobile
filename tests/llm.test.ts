import { describe, it, expect } from 'vitest';
import { groqProvider, mockProvider, openAiCompatProvider, anthropicProvider } from '../src/core/llm';

const resp = (status: number, body: any = {}) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const turns = [{ role: 'user' as const, content: 'hi' }];

describe('llm adapter (fake fetch only)', () => {
  it('returns text on success and sends the key only in the auth header', async () => {
    let seen: any;
    const p = groqProvider('SECRET-KEY-123', { fetchImpl: async (u, i) => { seen = { u, i }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'yo' } }] }) }; } });
    expect(await p.complete(turns)).toEqual({ ok: true, text: 'yo' });
    expect(seen.i.headers.authorization).toBe('Bearer SECRET-KEY-123');
    expect(seen.i.body).not.toContain('SECRET-KEY-123');
  });
  it('maps 401, 402, 429, 500 and empty answers to safe messages without the key', async () => {
    for (const [s, body] of [[401, {}], [402, {}], [429, {}], [500, {}], [200, { choices: [] }]] as const) {
      const r = await groqProvider('SECRET-KEY-123', { fetchImpl: resp(s, body) }).complete(turns);
      expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('SECRET-KEY-123');
    }
  });
  it('stops at the call cap and makes no further request', async () => {
    let n = 0; const p = groqProvider('k', { maxCalls: 2, fetchImpl: async () => { n++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'a' } }] }) }; } });
    await p.complete(turns); await p.complete(turns);
    expect((await p.complete(turns)).ok).toBe(false); expect(n).toBe(2);
  });
  it('network failure and missing key are reported, not thrown', async () => {
    expect((await groqProvider('k', { fetchImpl: async () => { throw new Error('boom SECRET'); } }).complete(turns)).ok).toBe(false);
    expect((await groqProvider('  ').complete(turns)).ok).toBe(false);
    expect((await mockProvider().complete(turns)).ok).toBe(true);
  });
});

describe('provider adapters (fake fetch only; no live call is made in this repo)', () => {
  it('openAiCompatProvider posts to the given base URL with the key only in the auth header', async () => {
    let seen: any;
    const p = openAiCompatProvider({ id: 'xai', baseUrl: 'https://api.x.ai/v1', apiKey: 'SECRET-KEY-9', model: 'grok-test', fetchImpl: async (u, i) => { seen = { u, i }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) }; } });
    expect(await p.complete(turns)).toEqual({ ok: true, text: 'hi' });
    expect(seen.u).toBe('https://api.x.ai/v1/chat/completions');
    expect(seen.i.headers.authorization).toBe('Bearer SECRET-KEY-9');
    expect(seen.u).not.toContain('SECRET-KEY-9');
    expect(seen.i.body).not.toContain('SECRET-KEY-9');
  });
  it('anthropicProvider posts system separately and maps the content blocks', async () => {
    let seen: any;
    const p = anthropicProvider({ apiKey: 'SECRET-KEY-7', model: 'claude-test', fetchImpl: async (u, i) => { seen = { u, i }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'hello' }] }) }; } });
    expect(await p.complete([{ role: 'system', content: 'sys' }, ...turns])).toEqual({ ok: true, text: 'hello' });
    expect(seen.u).toBe('https://api.anthropic.com/v1/messages');
    expect(seen.i.headers['x-api-key']).toBe('SECRET-KEY-7');
    expect(seen.i.body).not.toContain('SECRET-KEY-7');
    const body = JSON.parse(seen.i.body);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual(turns);
  });
  it('a missing model is refused before any request, and errors never carry the key', async () => {
    let n = 0;
    const p = anthropicProvider({ apiKey: 'SECRET-KEY-7', model: ' ', fetchImpl: async () => { n++; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect((await p.complete(turns)).ok).toBe(false);
    expect(n).toBe(0);
    for (const s of [401, 402, 429, 500] as const) {
      const r = await anthropicProvider({ apiKey: 'SECRET-KEY-7', model: 'm', fetchImpl: resp(s) }).complete(turns);
      expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('SECRET-KEY-7');
    }
  });
});
