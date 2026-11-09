import { describe, it, expect } from 'vitest';
import { groqProvider, mockProvider } from '../src/core/llm';

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
