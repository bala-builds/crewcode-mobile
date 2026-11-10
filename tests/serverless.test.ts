// Serverless deployment: GitHub App JWT, installation tokens, Contents-API
// storage with CAS, durable auth (signed one-time OAuth state, revocable
// sessions), the request handlers, and cold-start semantics across instances.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { appJwt, InstallationTokens, resolvePrivateKeyPem } from '../server/github-app';
import { readContents, writeContents, githubAuthStore, runServerlessOp } from '../server/github-storage';
import { issueSignedState, verifySignedState, consumeStateDurable, createSessionDurable, getSessionDurable, destroySessionDurable, type AuthStore, type AuthData } from '../server/durable-auth';
import { authStatus, startSignIn, finishSignIn, logout, apiPost, signedStateFromCookie, type ServerlessDeps } from '../server/serverless';
import { seedState } from '../src/core/store';

type F = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** In-memory GitHub Contents backend with real sha/CAS semantics. */
function fakeGitHub(failFirstPuts = 0) {
  const files = new Map<string, { sha: string; text: string }>();
  let seq = 0, puts = failFirstPuts;
  const counts = { get: 0, put: 0 };
  const fetchImpl: F = async (url, init) => {
    const m = url.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!m) throw new Error('unexpected url ' + url);
    const key = m[1];
    if (!init?.method || init.method === 'GET') {
      counts.get++;
      const f = files.get(key);
      if (!f) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
      return { ok: true, status: 200, json: async () => ({ sha: f.sha, content: Buffer.from(f.text, 'utf8').toString('base64') }) };
    }
    if (init.method === 'PUT') {
      counts.put++;
      if (puts-- > 0) return { ok: false, status: 409, json: async () => ({ message: 'shah mismatch' }) };
      const body = JSON.parse(init.body ?? '{}');
      const cur = files.get(key);
      if ((body.sha && body.sha !== cur?.sha) || (!body.sha && cur)) return { ok: false, status: 409, json: async () => ({ message: 'conflict' }) };
      files.set(key, { sha: 'sha' + ++seq, text: Buffer.from(body.content, 'base64').toString('utf8') });
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error('unexpected method ' + init.method);
  };
  return { fetchImpl, files, counts };
}

/** Adds the OAuth exchange + profile endpoints to a contents backend. */
function withOAuth(gh: { fetchImpl: F }, profile: { login: string; id: number }) {
  const f: F = async (url, init) => {
    if (url === 'https://github.com/login/oauth/access_token') return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => profile };
    return gh.fetchImpl(url, init);
  };
  return f;
}

const CFG = { clientId: 'Iv1.test', clientSecret: 'sec', callbackUrl: 'https://crewcode.example/api/auth/github/callback' };
function makeDeps(gh: { fetchImpl: F }, fetchImpl?: F): ServerlessDeps {
  const f = fetchImpl ?? gh.fetchImpl;
  return { fetchImpl: f, authCfg: CFG, sessionSecret: 'test-secret', authStore: githubAuthStore(f as never, { repo: 'o/r', token: 't' }), stateRepo: { repo: 'o/r', token: 't' }, appUrl: '/' };
}

describe('GitHub App auth', () => {
  it('mints a verifiable RS256 JWT with the app id as issuer', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = appJwt('12345', pem, 1_700_000_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload.iss).toBe('12345');
    expect(payload.exp - payload.iat).toBe(600);
    expect(crypto.verify('sha256', Buffer.from(h + '.' + p), publicKey.export({ type: 'spki', format: 'pem' }), Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('exchanges the JWT for an installation token and caches it until near expiry', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const calls: { url: string; auth?: string }[] = [];
    const f: F = async (url, init) => { calls.push({ url, auth: init?.headers?.authorization }); return { ok: true, status: 201, json: async () => ({ token: 'tok1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }) }; };
    const t = new InstallationTokens('12345', '987', pem, f as never);
    expect(await t.token()).toBe('tok1');
    expect(await t.token()).toBe('tok1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/app/installations/987/access_tokens');
    expect(calls[0].auth).toMatch(/^Bearer .+\..+\..+$/);
    const boom: F = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(new InstallationTokens('1', '2', pem, boom as never).token()).rejects.toThrow('installation token');
  });

  it('resolves the app private key from raw PEM, escaped-newline PEM, or base64 env forms', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
    expect(resolvePrivateKeyPem({ CREWCODE_GITHUB_APP_PRIVATE_KEY: pem })).toBe(pem);
    expect(resolvePrivateKeyPem({ CREWCODE_GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, '\\n') })).toBe(pem);
    expect(resolvePrivateKeyPem({ CREWCODE_GITHUB_APP_PRIVATE_KEY_B64: Buffer.from(pem, 'utf8').toString('base64') })).toBe(pem);
    expect(resolvePrivateKeyPem({})).toBeNull();
    // A resolved PEM must actually sign (not just string-match).
    expect(appJwt('1', resolvePrivateKeyPem({ CREWCODE_GITHUB_APP_PRIVATE_KEY: pem })!).split('.')).toHaveLength(3);
  });
});

describe('Contents storage with CAS', () => {
  it('round-trips state.json base64 and enforces the sha on writes', async () => {
    const gh = fakeGitHub();
    const c = { repo: 'o/r', path: 'state.json', token: 't' };
    expect(await readContents(gh.fetchImpl as never, c)).toBeNull();
    expect(await writeContents(gh.fetchImpl as never, c, null, '{"a":1}', 'm')).toBe('ok');
    const r = await readContents(gh.fetchImpl as never, c);
    expect(r?.text).toBe('{"a":1}');
    expect(await writeContents(gh.fetchImpl as never, c, 'wrong-sha', '{}', 'm')).toBe('conflict');
    expect(await writeContents(gh.fetchImpl as never, c, r!.sha, '{"a":2}', 'm')).toBe('ok');
  });

  it('runServerlessOp persists mutations, skips writes for read-only ops, retries on conflict', async () => {
    const uid = seedState().users[0].id;
    const gh = fakeGitHub();
    const cfg = { repo: 'o/r', token: 't' };
    const ro = await runServerlessOp(gh.fetchImpl as never, cfg, { as: uid, op: 'listUsers' });
    expect(ro.ok).toBe(true);
    expect(gh.counts.put).toBe(0);
    const mk = await runServerlessOp(gh.fetchImpl as never, cfg, { as: uid, op: 'createProject', args: { name: 'Demo App', prd: 'Build a demo application.', instructions: 'Keep it small.' } });
    expect(mk.ok).toBe(true);
    expect(gh.files.get('state.json')?.text).toContain('Demo App');
    const gh2 = fakeGitHub(1); // first PUT 409s
    const mk2 = await runServerlessOp(gh2.fetchImpl as never, cfg, { as: uid, op: 'createProject', args: { name: 'Retry App', prd: 'Build a retry application.', instructions: 'x' } });
    expect(mk2.ok).toBe(true);
    expect(gh2.counts.get).toBeGreaterThanOrEqual(2); // re-read after conflict
    expect(gh2.files.get('state.json')?.text).toContain('Retry App');
  });

  it('binds the signed-in GitHub account as the caller, never the client-supplied identity', async () => {
    const gh = fakeGitHub();
    const res = await runServerlessOp(gh.fetchImpl as never, { repo: 'o/r', token: 't' }, { as: 'attacker', op: 'listUsers' }, { githubId: 42, login: 'balu' });
    expect(res.ok).toBe(true);
    const st = JSON.parse(gh.files.get('state.json')!.text);
    const u = st.users.find((x: { githubId?: number }) => x.githubId === 42);
    expect(u.name).toBe('balu');
  });
});

describe('durable auth', () => {
  it('signed state: round-trips, rejects tamper, wrong secret, expiry and bad shapes', () => {
    const s = issueSignedState('k1', 1000);
    expect(verifySignedState(s, 'k1', 1001)).toBe(s.split('.')[0]);
    expect(verifySignedState(s.slice(0, -2) + 'zz', 'k1', 1001)).toBeNull();
    expect(verifySignedState(s, 'k2', 1001)).toBeNull();
    expect(verifySignedState(s, 'k1', 1000 + 11 * 60 * 1000)).toBeNull();
    expect(verifySignedState('garbage', 'k1', 1001)).toBeNull();
  });

  it('state consume is durably one-time across store instances, even through a write conflict', async () => {
    const gh = fakeGitHub();
    const a = githubAuthStore(gh.fetchImpl as never, { repo: 'o/r', token: 't' });
    const b = githubAuthStore(gh.fetchImpl as never, { repo: 'o/r', token: 't' }); // second "instance"
    expect(await consumeStateDurable(a, 'n'.repeat(32))).toBe(true);
    expect(await consumeStateDurable(b, 'n'.repeat(32))).toBe(false); // replay seen by another instance
  });

  it('sessions persist across instances and logout revokes durably', async () => {
    const gh = fakeGitHub();
    const a = githubAuthStore(gh.fetchImpl as never, { repo: 'o/r', token: 't' });
    const b = githubAuthStore(gh.fetchImpl as never, { repo: 'o/r', token: 't' });
    const s = await createSessionDurable(a, 42, 'balu');
    if (s === 'conflict') throw new Error('unexpected conflict');
    expect((await getSessionDurable(b, s.id))?.login).toBe('balu'); // cold-start read
    await destroySessionDurable(b, s.id);
    expect(await getSessionDurable(a, s.id)).toBeNull();
    expect(await getSessionDurable(a, 'z'.repeat(32))).toBeNull();
    expect(await getSessionDurable(a, 'not hex!')).toBeNull();
  });

  it('expired sessions are absent', async () => {
    const gh = fakeGitHub();
    const store: AuthStore = githubAuthStore(gh.fetchImpl as never, { repo: 'o/r', token: 't' });
    const now = Date.now();
    const s = await createSessionDurable(store, 7, 'old', now);
    if (s === 'conflict') throw new Error('unexpected conflict');
    expect(await getSessionDurable(store, s.id, now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe('serverless handlers', () => {
  it('status reports sign-in configured, no session, and honest storage/needle labels', async () => {
    const r = await authStatus(makeDeps(fakeGitHub()));
    expect(r.status).toBe(200);
    const b = r.body as Record<string, unknown>;
    expect(b.githubSignIn).toBe('configured');
    expect(b.session).toBeNull();
    expect(String(b.storage)).toContain('o/r');
    expect(String(b.needle)).toContain('disabled');
  });

  it('sign-in flow: browser-bound signed state, one-time use, durable session, working logout', async () => {
    const gh = fakeGitHub();
    const deps = makeDeps(gh, withOAuth(gh, { login: 'balu', id: 42 }));
    const start = startSignIn(deps);
    expect(start.status).toBe(302);
    expect(start.location).toContain('https://github.com/login/oauth/authorize');
    expect(start.setCookie).toContain('; Secure');
    const state = new URL(start.location!).searchParams.get('state')!;
    expect(signedStateFromCookie(start.setCookie)).toBe(state);
    // Another browser (no matching cookie) is rejected.
    expect((await finishSignIn(deps, { code: 'c', state }, 'crewcode_oauth_state=' + 'f'.repeat(32))).status).toBe(400);
    // Tampered state is rejected before any storage write.
    expect((await finishSignIn(deps, { code: 'c', state: state.slice(0, -2) + 'aa' }, start.setCookie)).status).toBe(400);
    // Happy path: 302 to the app with a Secure HttpOnly session cookie.
    const fin = await finishSignIn(deps, { code: 'c', state }, start.setCookie);
    expect(fin.status).toBe(302);
    expect(fin.location).toBe('/');
    expect(fin.setCookie).toContain('HttpOnly');
    expect(fin.setCookie).toContain('; Secure');
    expect(JSON.stringify(fin)).not.toContain('test-secret');
    // Replay of the same state fails durably.
    expect((await finishSignIn(deps, { code: 'c', state }, start.setCookie)).status).toBe(400);
    // Session is visible to a cold instance and logout revokes it everywhere.
    const deps2 = makeDeps(gh, withOAuth(gh, { login: 'balu', id: 42 }));
    const st1 = await authStatus(deps2, fin.setCookie);
    expect((st1.body as { session: { githubLogin: string } }).session.githubLogin).toBe('balu');
    await logout(deps2, fin.setCookie);
    expect((await authStatus(deps, fin.setCookie)).body!.session).toBeNull();
  });

  it('api: 401 signed-out, 503 without storage, identity rebound when signed in, state durable across instances', async () => {
    const gh = fakeGitHub();
    const deps = makeDeps(gh, withOAuth(gh, { login: 'balu', id: 42 }));
    expect((await apiPost(deps, undefined, { as: 'x', op: 'listUsers' })).status).toBe(401);
    const noStore = { ...deps, stateRepo: null };
    expect((await apiPost(noStore, undefined, { as: 'x', op: 'listUsers' })).status).toBe(503);
    const start = startSignIn(deps);
    const state = new URL(start.location!).searchParams.get('state')!;
    const fin = await finishSignIn(deps, { code: 'c', state }, start.setCookie);
    const users = await apiPost(deps, fin.setCookie, { as: 'attacker', op: 'listUsers' });
    expect(users.status).toBe(200);
    const names = JSON.stringify(users.body);
    expect(names).toContain('balu');
    const mk = await apiPost(deps, fin.setCookie, { as: 'attacker', op: 'createProject', args: { name: 'Phone App', prd: 'Built from a phone.', instructions: 'x' } });
    expect((mk.body as { ok: boolean }).ok).toBe(true);
    const deps2 = makeDeps(gh, withOAuth(gh, { login: 'balu', id: 42 }));
    const list = await apiPost(deps2, fin.setCookie, { as: 'x', op: 'listProjects' });
    expect(JSON.stringify(list.body)).toContain('Phone App');
  });

  it('without durable storage: sign-in callback fails closed 503, logout still clears the cookie', async () => {
    const gh = fakeGitHub();
    const deps = makeDeps(gh, withOAuth(gh, { login: 'balu', id: 42 }));
    const noStore = { ...deps, stateRepo: null };
    const start = startSignIn(noStore);
    expect(start.status).toBe(302);
    const state = new URL(start.location!).searchParams.get('state')!;
    const fin = await finishSignIn(noStore, { code: 'c', state }, start.setCookie);
    expect(fin.status).toBe(503);
    expect(JSON.stringify(fin.body)).toContain('Durable storage is not configured');
    // State was NOT consumed: the same signed state still verifies (replay-safe fail).
    const lo = await logout(noStore, 'crewcode_session=abc');
    expect(lo.status).toBe(200);
    expect(lo.setCookie).toContain('Max-Age=0');
  });
});
