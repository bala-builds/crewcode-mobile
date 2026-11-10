// Serverless deployment handlers. Pure request-in/result-out functions so the
// whole deployment path is testable without HTTP, including cold-start
// semantics: construct fresh deps over the same store and nothing is lost.
// Identity is server-enforced exactly like the dev server: a valid GitHub
// session decides `as`, never the client. Test identities do NOT exist here -
// deployment always runs in the dev server's CREWCODE_REQUIRE_AUTH=1 posture.
import type { AuthConfig, FetchLike } from './auth';
import { exchangeCodeForProfile, sessionCookie, clearSessionCookie, sessionIdFromCookie, STATE_COOKIE } from './auth';
import { issueSignedState, verifySignedState, consumeStateDurable, createSessionDurable, getSessionDurable, destroySessionDurable, type AuthStore } from './durable-auth';
import { runServerlessOp } from './github-storage';
import type { ApiRequest } from '../src/server/api';

export interface ServerlessDeps {
  fetchImpl: FetchLike;
  authCfg: AuthConfig | null;
  sessionSecret: string;
  authStore: AuthStore;
  /** Private repo holding state.json; null reports not-configured honestly. */
  stateRepo: { repo: string; token: string } | null;
  appUrl: string;
}
export type Result = { status: number; body?: Record<string, unknown>; location?: string; setCookie?: string };

/** The signed state value is longer than the dev 32-hex nonce, so it needs its own cookie read. */
export function signedStateFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(STATE_COOKIE + '='));
  const v = m?.slice(STATE_COOKIE.length + 1);
  return v && /^[0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]+$/.test(v) ? v : undefined;
}
export function signedStateCookie(state: string, secure: boolean): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}

export async function authStatus(deps: ServerlessDeps, cookieHeader?: string): Promise<Result> {
  const session = await getSessionDurable(deps.authStore, sessionIdFromCookie(cookieHeader));
  return {
    status: 200,
    body: {
      ok: true,
      deployment: 'vercel-serverless',
      githubSignIn: deps.authCfg ? 'configured' : 'not-configured',
      session: session ? { githubLogin: session.login } : null,
      storage: deps.stateRepo ? 'GitHub private repo ' + deps.stateRepo.repo + ' (state.json)' : 'not-configured',
      githubStorage: deps.stateRepo ? 'configured' : 'not-configured: CREWCODE_DATA_REPO or the GitHub App installation is missing',
      needle: process.env.NEEDLE_ENABLED ? 'enabled' : 'disabled in this deployment (Python sidecar cannot run in a Vercel function)',
    },
  };
}

export function startSignIn(deps: ServerlessDeps): Result {
  if (!deps.authCfg) return { status: 404, body: { ok: false, error: 'GitHub sign-in is not configured on this server.' } };
  const state = issueSignedState(deps.sessionSecret);
  const q = new URLSearchParams({ client_id: deps.authCfg.clientId, redirect_uri: deps.authCfg.callbackUrl, state });
  return { status: 302, location: 'https://github.com/login/oauth/authorize?' + q.toString(), setCookie: signedStateCookie(state, deps.authCfg.callbackUrl.startsWith('https:')) };
}

export async function finishSignIn(deps: ServerlessDeps, query: { code?: string; state?: string }, cookieHeader?: string): Promise<Result> {
  const cfg = deps.authCfg;
  if (!cfg) return { status: 404, body: { ok: false, error: 'GitHub sign-in is not configured on this server.' } };
  // Durable state/session storage is required to finish sign-in safely.
  if (!deps.stateRepo) return { status: 503, body: { ok: false, error: 'Durable storage is not configured on this deployment.' } };
  if (!query.code || !query.state) return { status: 400, body: { ok: false, error: 'Missing code or state.' } };
  // Same-browser binding: the state value must arrive in BOTH the query and the
  // HttpOnly cookie set when sign-in started.
  const cookieState = signedStateFromCookie(cookieHeader);
  if (!cookieState || cookieState !== query.state) return { status: 400, body: { ok: false, error: 'State cookie mismatch. Start sign-in again in the same browser.' } };
  // Signature + expiry first (no storage read for forgeries)...
  const nonce = verifySignedState(query.state, deps.sessionSecret);
  if (!nonce) return { status: 400, body: { ok: false, error: 'State mismatch. Start sign-in again.' } };
  // ...then durable one-time use across every function instance.
  if (!(await consumeStateDurable(deps.authStore, nonce))) return { status: 400, body: { ok: false, error: 'State mismatch. Start sign-in again.' } };
  const p = await exchangeCodeForProfile(cfg, query.code, deps.fetchImpl);
  if ('status' in p) return p;
  const s = await createSessionDurable(deps.authStore, p.githubId, p.login);
  if (s === 'conflict') return { status: 500, body: { ok: false, error: 'Could not create a session. Retry.' } };
  return { status: 302, location: deps.appUrl, setCookie: sessionCookie(s.id, cfg.callbackUrl.startsWith('https:')) };
}

export async function logout(deps: ServerlessDeps, cookieHeader?: string): Promise<Result> {
  if (deps.stateRepo) await destroySessionDurable(deps.authStore, sessionIdFromCookie(cookieHeader));
  return { status: 200, body: { ok: true }, setCookie: clearSessionCookie(!!deps.authCfg && deps.authCfg.callbackUrl.startsWith('https:')) };
}

export async function apiPost(deps: ServerlessDeps, cookieHeader: string | undefined, input: ApiRequest): Promise<Result> {
  if (!deps.stateRepo) return { status: 503, body: { ok: false, error: 'Durable storage is not configured on this deployment.' } };
  const session = await getSessionDurable(deps.authStore, sessionIdFromCookie(cookieHeader));
  if (!session) return { status: 401, body: { ok: false, error: 'Sign in with GitHub first.' } };
  try {
    const res = await runServerlessOp(deps.fetchImpl, deps.stateRepo, input, { githubId: session.githubId, login: session.login });
    return { status: 200, body: res as unknown as Record<string, unknown> };
  } catch {
    return { status: 502, body: { ok: false, error: 'Storage error. Retry.' } };
  }
}
