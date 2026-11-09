import { afterEach, it, expect, vi } from 'vitest';
import { HttpClient } from '../src/ui/client';
afterEach(() => { vi.unstubAllGlobals(); });
const req = { as: 'u-ram', op: 'listProjects' };
it('reports unreachable server, invalid JSON, and malformed response without throwing', async () => {
  for (const impl of [() => Promise.reject(Error('offline')), () => Promise.resolve({ json: () => Promise.reject(Error('bad JSON')) }), () => Promise.resolve({ json: async () => ({ status: 'wrong' }) })]) {
    vi.stubGlobal('fetch', impl);
    expect((await new HttpClient('/api').call(req)).ok).toBe(false);
  }
});
it('passes the real request body and returns API errors including rate limits', async () => {
  const f = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: false, json: async () => ({ ok: false, error: 'Too many requests.' }) }));
  vi.stubGlobal('fetch', f);
  expect(await new HttpClient('/api').call(req)).toEqual({ ok: false, error: 'Too many requests.' });
  expect(JSON.parse(f.mock.calls[0][1].body as string)).toEqual(req);
});
