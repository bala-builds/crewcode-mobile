// Loopback-only dev API. Caller ids are TEST identities, not authenticated accounts.
import http from 'node:http';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { Api } from '../src/server/api';
import { authFromEnv, startGithubSignIn, finishGithubSignIn, getSession, destroySession, sessionIdFromCookie, clearSessionCookie } from './auth';
import type { AppState } from '../src/core/types';

const FILE = process.env.CREWCODE_DATA ?? new URL('./data.json', import.meta.url).pathname;
let initial: AppState | undefined;
try { initial = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
const api = new Api(initial, (s) => fs.writeFileSync(FILE, JSON.stringify(s)));
const MAX_BYTES = 1_000_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300; // One loopback dev client; not a hosted multi-user limiter.
let windowStart = Date.now(), count = 0;
const authCfg = authFromEnv(process.env);
// CREWCODE_REQUIRE_AUTH=1 turns test identities off: /api then acts only as the
// signed-in GitHub account. Default off because this is a loopback dev server.
const requireAuth = process.env.CREWCODE_REQUIRE_AUTH === '1';
const send = (res: http.ServerResponse, r: { status: number; body?: Record<string, unknown>; location?: string; setCookie?: string }) => {
  if (res.writableEnded) return;
  const headers: Record<string, string> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (r.setCookie) headers['set-cookie'] = r.setCookie;
  if (r.location) { res.writeHead(302, { ...headers, location: r.location }).end(); return; }
  res.writeHead(r.status, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(r.body ?? {}));
};
const server = http.createServer((req, res) => {
  const reply = (status: number, value: unknown) => {
    if (!res.writableEnded) res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(JSON.stringify(value));
  };
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const session = getSession(sessionIdFromCookie(req.headers.cookie));
  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    send(res, { status: 200, body: { ok: true, githubSignIn: authCfg ? 'configured' : 'not-configured', session: session ? { githubLogin: session.login } : null } });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/github') { send(res, startGithubSignIn(authCfg)); return; }
  if (req.method === 'GET' && url.pathname === '/api/auth/github/callback') {
    void finishGithubSignIn(authCfg, { code: url.searchParams.get('code') ?? undefined, state: url.searchParams.get('state') ?? undefined }, fetch as never)
      .then((r) => send(res, r)).catch(() => reply(500, { ok: false, error: 'Server error.' }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    destroySession(sessionIdFromCookie(req.headers.cookie));
    send(res, { status: 200, body: { ok: true }, setCookie: clearSessionCookie() });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/api') { reply(404, { ok: false, error: 'Not found.' }); return; }
  if (Date.now() - windowStart >= WINDOW_MS) { windowStart = Date.now(); count = 0; }
  if (++count > MAX_REQUESTS) { reply(429, { ok: false, error: 'Too many requests. Wait one minute and retry.' }); req.resume(); return; }
  if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { ok: false, error: 'Use application/json.' }); req.resume(); return; }
  let bytes = 0, body = '', oversized = false;
  const decoder = new StringDecoder('utf8');
  req.on('data', (c: Buffer) => {
    bytes += c.length;
    if (bytes > MAX_BYTES) { oversized = true; body = ''; reply(413, { ok: false, error: 'Request exceeds 1 MB.' }); return; }
    if (!oversized) body += decoder.write(c);
  });
  req.on('end', () => { void (async () => {
    if (oversized) return;
    body += decoder.end();
    let input;
    try { input = JSON.parse(body); } catch { reply(400, { ok: false, error: 'Invalid JSON.' }); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.as !== 'string' || typeof input.op !== 'string' || (input.args !== undefined && (!input.args || typeof input.args !== 'object' || Array.isArray(input.args)))) {
      reply(400, { ok: false, error: 'Expected as, op and optional args object.' }); return;
    }
    // Server-enforced identity: a valid GitHub session decides who you are, never
    // the client-supplied `as`. Without a session, test identities apply only in
    // loopback dev mode (CREWCODE_REQUIRE_AUTH unset).
    if (session) {
      try { input.as = api.ensureGithubUser(session.githubId, session.login); }
      catch { reply(500, { ok: false, error: 'Could not resolve the signed-in account.' }); return; }
    } else if (requireAuth) { reply(401, { ok: false, error: 'Sign in with GitHub first.' }); return; }
    try { reply(200, await api.callAsync(input)); } catch { reply(400, { ok: false, error: 'Bad request. Check field types.' }); }
  })().catch(() => reply(500, { ok: false, error: 'Server error.' }));
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log('CrewCode dev API on http://127.0.0.1:' + (process.env.PORT ?? 8787) + '/api (test identities only)'));
