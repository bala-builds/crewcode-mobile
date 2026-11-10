// HTTP plumbing shared by the Vercel function files in api/. Kept tiny and
// dependency-free: no @vercel/node types, structural req/res only.
import { authFromEnv, type FetchLike } from './auth';
import { InstallationTokens, resolvePrivateKeyPem } from './github-app';
import { githubAuthStore } from './github-storage';
import type { ServerlessDeps } from './serverless';

export interface ReqLike { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on(ev: string, cb: (c?: Buffer) => void): void }
export interface ResLike { writeHead(status: number, headers: Record<string, string>): unknown; end(body?: string): void; writableEnded?: boolean }

const MAX_BYTES = 1_000_000;

export function send(res: ResLike, r: { status: number; body?: Record<string, unknown>; location?: string; setCookie?: string }): void {
  if (res.writableEnded) return;
  const headers: Record<string, string> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (r.setCookie) headers['set-cookie'] = r.setCookie;
  if (r.location) { res.writeHead(302, { ...headers, location: r.location }); res.end(); return; }
  res.writeHead(r.status, { ...headers, 'content-type': 'application/json' });
  res.end(JSON.stringify(r.body ?? {}));
}

/** Raw body read (functions disable Vercel's body parser so limits match dev). */
export function readJsonBody(req: ReqLike): Promise<{ ok: true; input: { as: string; op: string; args?: Record<string, unknown> } } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    const ct = req.headers['content-type'];
    if (!ct || !(Array.isArray(ct) ? ct[0] : ct).startsWith('application/json')) { resolve({ ok: false, status: 415, error: 'Use application/json.' }); return; }
    let bytes = 0, body = '', done = false;
    req.on('data', (c?: Buffer) => {
      if (done || !c) return;
      bytes += c.length;
      if (bytes > MAX_BYTES) { done = true; resolve({ ok: false, status: 413, error: 'Request exceeds 1 MB.' }); return; }
      body += c.toString('utf8');
    });
    req.on('end', () => {
      if (done) return;
      let input: unknown;
      try { input = JSON.parse(body); } catch { resolve({ ok: false, status: 400, error: 'Invalid JSON.' }); return; }
      const i = input as Record<string, unknown>;
      if (!i || typeof i !== 'object' || Array.isArray(i) || typeof i.as !== 'string' || typeof i.op !== 'string' || (i.args !== undefined && (!i.args || typeof i.args !== 'object' || Array.isArray(i.args)))) {
        resolve({ ok: false, status: 400, error: 'Expected as, op and optional args object.' }); return;
      }
      resolve({ ok: true, input: i as never });
    });
  });
}

/**
 * Deployment deps from environment. Secrets arrive only as env vars populated
 * from the vault: CREWCODE_GITHUB_CLIENT_ID/SECRET (OAuth), CREWCODE_GITHUB_APP_ID,
 * CREWCODE_GITHUB_APP_PRIVATE_KEY (raw PEM) or CREWCODE_GITHUB_APP_PRIVATE_KEY_B64,
 * CREWCODE_GITHUB_APP_INSTALLATION_ID,
 * CREWCODE_DATA_REPO, CREWCODE_SESSION_SECRET, optional CREWCODE_APP_URL.
 */
export async function envDeps(env: Record<string, string | undefined>): Promise<ServerlessDeps> {
  const fetchImpl = fetch as unknown as FetchLike;
  const authCfg = authFromEnv(env);
  const sessionSecret = env.CREWCODE_SESSION_SECRET?.trim() ?? '';
  const appId = env.CREWCODE_GITHUB_APP_ID?.trim();
  const installId = env.CREWCODE_GITHUB_APP_INSTALLATION_ID?.trim();
  const pem = resolvePrivateKeyPem(env);
  const repo = env.CREWCODE_DATA_REPO?.trim();
  let stateRepo: ServerlessDeps['stateRepo'] = null;
  let token = '';
  if (appId && installId && pem && repo) {
    const tokens = new InstallationTokens(appId, installId, pem, fetchImpl as never);
    token = await tokens.token();
    stateRepo = { repo, token };
  }
  const authStore = githubAuthStore(fetchImpl as never, { repo: repo ?? 'unused/unused', token });
  return { fetchImpl, authCfg, sessionSecret, authStore, stateRepo, appUrl: env.CREWCODE_APP_URL?.trim() || '/' };
}
