import { beforeAll, afterAll, it, expect } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
let server: ChildProcess;
const file = `/tmp/crewcode-hardening-${process.pid}.json`;
const url = 'http://127.0.0.1:8976/api';
beforeAll(async () => {
  execSync('npm run server:build', { stdio: 'ignore' });
  server = spawn('node', ['dist-server/index.js'], { env: { ...process.env, PORT: '8976', CREWCODE_DATA: file }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  throw Error('server did not start');
}, 30_000);
afterAll(() => { server?.kill(); try { fs.unlinkSync(file); } catch {} });
const post = (body: string, type = 'application/json') => fetch(url, { method: 'POST', headers: { 'content-type': type }, body });
it('rejects malformed JSON, invalid request shape, wrong media type, and oversized UTF-8 bytes', async () => {
  expect((await post('{')).status).toBe(400);
  for (const value of [null, [], {}, { as: 'u-ram', op: 'listProjects', args: [] }]) expect((await post(JSON.stringify(value))).status).toBe(400);
  expect((await post('{"as":"u-ram","op":"listProjects"}', 'text/plain')).status).toBe(415);
  expect((await post('"' + '\u20ac'.repeat(340_000) + '"')).status).toBe(413);
});
it('does not enable opaque-origin iframe CORS or form/simple POST mutations', async () => {
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  expect(preflight.status).toBe(404);
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) expect((await post('{"as":"u-ram","op":"registerName","args":{"name":"Injected"}}', type)).status).toBe(415);
});
it('limits loopback requests and gives JSON error, not an unbounded burst', async () => {
  let limited = false;
  for (let i = 0; i < 301; i++) {
    const r = await post('{"as":"u-ram","op":"listUsers"}');
    if (r.status === 429) { expect((await r.json()).ok).toBe(false); limited = true; break; }
  }
  expect(limited).toBe(true);
});
