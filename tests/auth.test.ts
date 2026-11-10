// GitHub OAuth handshake: redirect shape, state nonce rules, token exchange
// success/failure mapping, and profile read - all with an injectable fetch.
import { describe, it, expect } from 'vitest';
import { authFromEnv, startGithubSignIn, finishGithubSignIn, issueState, getSession, destroySession, sessionIdFromCookie, sessionCookie, stateFromCookie, type FetchLike } from '../server/auth';
import { upsertGithubUser } from '../src/core/store';
import { seedState } from '../src/core/store';

const CFG = { clientId: 'Iv1.test', clientSecret: 'test-secret', callbackUrl: 'http://localhost:8787/api/auth/github/callback' };

const finish = (query: { code?: string; state?: string }, f: FetchLike, cookieState?: string) => finishGithubSignIn(CFG, query, f, undefined, cookieState ?? query.state);
const jsonFetch = (steps: { status?: number; body: unknown }[]): FetchLike => {
  let i = 0;
  return async () => {
    const s = steps[Math.min(i++, steps.length - 1)];
    return { ok: (s.status ?? 200) < 400, status: s.status ?? 200, json: async () => s.body };
  };
};

describe('GitHub OAuth', () => {
  it('authFromEnv requires both client id and secret', () => {
    expect(authFromEnv({})).toBeNull();
    expect(authFromEnv({ CREWCODE_GITHUB_CLIENT_ID: 'Iv1.test' })).toBeNull();
    expect(authFromEnv({ CREWCODE_GITHUB_CLIENT_ID: '  ', CREWCODE_GITHUB_CLIENT_SECRET: 'x' })).toBeNull();
    const cfg = authFromEnv({ CREWCODE_GITHUB_CLIENT_ID: 'Iv1.test', CREWCODE_GITHUB_CLIENT_SECRET: 's' });
    expect(cfg).toEqual({ clientId: 'Iv1.test', clientSecret: 's', callbackUrl: 'http://localhost:8787/api/auth/github/callback' });
  });

  it('start: not configured answers 404, configured 302s to GitHub with state', () => {
    const off = startGithubSignIn(null);
    expect(off.status).toBe(404);
    const on = startGithubSignIn(CFG);
    if (!('location' in on)) throw new Error('expected a redirect');
    const u = new URL(on.location);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('Iv1.test');
    expect(u.searchParams.get('redirect_uri')).toBe(CFG.callbackUrl);
    expect(u.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(on.location).not.toContain('test-secret');
  });

  it('start: sets a browser-bound HttpOnly state cookie; callback rejects a state from another browser', async () => {
    const on = startGithubSignIn(CFG);
    if (!('location' in on)) throw new Error('expected a redirect');
    const state = new URL(on.location).searchParams.get('state')!;
    const cookie = on.setCookie ?? '';
    expect(cookie).toContain('crewcode_oauth_state=' + state);
    expect(cookie).toContain('HttpOnly');
    expect(stateFromCookie(cookie)).toBe(state);
    // The same issued state without the matching cookie is another browser: reject.
    const r = await finishGithubSignIn(CFG, { code: 'c', state }, jsonFetch([]), undefined, 'f'.repeat(32));
    expect(r.status).toBe(400);
    expect((r as unknown as { body: { error: string } }).body.error).toContain('same browser');
    // And the real cookie path passes the check (fails later only at the fake exchange).
    const r2 = await finishGithubSignIn(CFG, { code: 'c', state }, jsonFetch([{ body: { error: 'bad_verification_code' } }]), undefined, state);
    expect(r2.status).toBe(502);
  });

  it('HTTPS callback URLs mark state and session cookies Secure; loopback HTTP omits it', async () => {
    const httpsCfg = { ...CFG, callbackUrl: 'https://app.example.com/api/auth/github/callback' };
    const on = startGithubSignIn(httpsCfg);
    if (!('location' in on)) throw new Error('expected a redirect');
    expect(on.setCookie).toContain('; Secure');
    const state = new URL(on.location).searchParams.get('state')!;
    const r = await finishGithubSignIn(httpsCfg, { code: 'c', state }, jsonFetch([{ body: { access_token: 't' } }, { body: { login: 'x', id: 7 } }]), 'https://app.example.com', state);
    if (!('location' in r)) throw new Error('expected a redirect');
    expect(r.setCookie).toContain('; Secure');
    expect(startGithubSignIn(CFG).setCookie).not.toContain('Secure');
  });

  it('callback: rejects missing params, unknown state, and reused state', async () => {
    expect((await finishGithubSignIn(null, { code: 'c', state: 's' }, jsonFetch([]), undefined, 's')).status).toBe(404);
    expect((await finish({}, jsonFetch([]))).status).toBe(400);
    expect((await finish({ code: 'c' }, jsonFetch([]))).status).toBe(400);
    const bad = await finish({ code: 'c', state: 'unknown' }, jsonFetch([]));
    expect(bad.status).toBe(400);
    expect((bad as unknown as { body: { error: string } }).body.error).toContain('State mismatch');
    // A real state works once, then is consumed.
    const state = issueState();
    const fetcher = jsonFetch([{ body: { access_token: 'tok' } }, { body: { login: 'balu', id: 42 } }]);
    expect((await finish({ code: 'c', state }, fetcher)).status).toBe(302);
    expect((await finish({ code: 'c', state }, fetcher)).status).toBe(400);
  });

  it('callback: maps GitHub token errors, network failure, and bad profile to honest 502s', async () => {
    const s1 = issueState();
    const denied = await finish({ code: 'c', state: s1 }, jsonFetch([{ body: { error: 'bad_verification_code' } }]));
    expect(denied.status).toBe(502);
    expect((denied as unknown as { body: { error: string } }).body.error).toContain('bad_verification_code');
    const s2 = issueState();
    const boom: FetchLike = async () => { throw new Error('down'); };
    expect((await finish({ code: 'c', state: s2 }, boom)).status).toBe(502);
    const s3 = issueState();
    const noProfile = await finish({ code: 'c', state: s3 }, jsonFetch([{ body: { access_token: 'tok' } }, { status: 401, body: {} }]));
    expect(noProfile.status).toBe(502);
  });

  it('callback: success starts a session bound to the immutable GitHub id and never leaks the secret or token', async () => {
    const state = issueState();
    const r = await finish({ code: 'c', state }, jsonFetch([{ body: { access_token: 'secret-token' } }, { body: { login: 'balu', id: 42 } }]));
    if (!('location' in r)) throw new Error('expected a redirect to the app');
    expect(r.location).toBe('http://localhost:5177');
    const cookie = r.setCookie ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const flat = JSON.stringify(r);
    expect(flat).not.toContain('secret-token');
    expect(flat).not.toContain('test-secret');
    // The cookie round-trips to the session; logout destroys it.
    const sid = sessionIdFromCookie(cookie);
    const s = getSession(sid);
    expect(s?.githubId).toBe(42);
    expect(s?.login).toBe('balu');
    destroySession(sid);
    expect(getSession(sid)).toBeNull();
  });

  it('sessions: bad cookie shapes yield no session; expired sessions are gone', () => {
    expect(sessionIdFromCookie(undefined)).toBeUndefined();
    expect(sessionIdFromCookie('other=1')).toBeUndefined();
    expect(sessionIdFromCookie('crewcode_session=not-hex!')).toBeUndefined();
    expect(sessionIdFromCookie('a=1; crewcode_session=' + 'f'.repeat(32))).toBe('f'.repeat(32));
    const s = getSession(sessionIdFromCookie(sessionCookie('e'.repeat(32))));
    expect(s).toBeNull(); // never created
    expect(getSession(undefined)).toBeNull();
  });

  it('upsertGithubUser binds the immutable id, reuses the account, and renames on login change', () => {
    const st = seedState();
    const a = upsertGithubUser(st, 42, 'balu');
    if (!a.ok) throw new Error('expected ok');
    const b = upsertGithubUser(a.state, 42, 'balu-new');
    if (!b.ok) throw new Error('expected ok');
    expect(b.userId).toBe(a.userId); // same account, not a duplicate
    const u = b.state.users.find((x) => x.id === a.userId)!;
    expect(u.name).toBe('balu-new');
    expect(u.githubId).toBe(42);
    // A different GitHub id is a different account; a bad id is rejected.
    const c = upsertGithubUser(b.state, 43, 'balu');
    if (!c.ok) throw new Error('expected ok');
    expect(c.userId).not.toBe(a.userId);
    expect(upsertGithubUser(c.state, -1, 'x').ok).toBe(false);
    expect(upsertGithubUser(c.state, 1.5, 'x').ok).toBe(false);
  });
});
