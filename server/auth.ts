// GitHub OAuth web flow for the dev server. The client secret arrives only via
// environment (CREWCODE_GITHUB_CLIENT_ID / CREWCODE_GITHUB_CLIENT_SECRET),
// populated from the vault at process start - never from code, chat or the repo.
// These handlers complete the sign-in handshake and return the GitHub login as
// proof. They do NOT yet replace test identities with authenticated sessions;
// the Settings UI says so until session wiring lands.

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function authFromEnv(env: Record<string, string | undefined>): AuthConfig | null {
  const clientId = env.CREWCODE_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.CREWCODE_GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const callbackUrl = env.CREWCODE_GITHUB_CALLBACK_URL?.trim() || 'http://localhost:8787/api/auth/github/callback';
  return { clientId, clientSecret, callbackUrl };
}

// In-memory state nonces, single-process dev server, 10 minute expiry.
const STATE_TTL_MS = 10 * 60 * 1000;
const states = new Map<string, number>();

export function issueState(now = Date.now()): string {
  for (const [s, t] of states) if (now - t > STATE_TTL_MS) states.delete(s);
  const s = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  states.set(s, now);
  return s;
}

export function consumeState(s: string, now = Date.now()): boolean {
  const t = states.get(s);
  if (t === undefined || now - t > STATE_TTL_MS) return false;
  states.delete(s); // one-time use
  return true;
}

export type AuthResult = { status: number; body: Record<string, unknown>; setCookie?: string } | { status: 302; location: string; setCookie?: string };

// --- Sessions -------------------------------------------------------------
// Server-side sessions keyed by an unguessable id in an HttpOnly cookie. The
// cookie value is the only client-held token; it never carries the GitHub token.
// Loopback dev runs plain HTTP, so Secure is omitted - a hosted deployment must
// serve HTTPS and add it.
export interface Session { id: string; githubId: number; login: string; createdAt: number; expiresAt: number }
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();

const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function createSession(githubId: number, login: string, now = Date.now()): Session {
  const s: Session = { id: newToken(), githubId, login, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string | undefined, now = Date.now()): Session | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (now >= s.expiresAt) { sessions.delete(id); return null; }
  return s;
}

export function destroySession(id: string | undefined): void { if (id) sessions.delete(id); }

// Loopback dev runs plain HTTP; over HTTPS (deployed) cookies get Secure.
// CSRF posture for authenticated mutations: the session cookie is SameSite=Lax
// (not sent on cross-site POSTs) and /api only accepts application/json bodies,
// which cross-site forms cannot send. CREWCODE_REQUIRE_AUTH=1 removes the test
// identity path entirely for deployment.
export const SESSION_COOKIE = 'crewcode_session';
export function sessionCookie(id: string, secure = false): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure = false): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
export function sessionIdFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(SESSION_COOKIE + '='));
  const v = m?.slice(SESSION_COOKIE.length + 1);
  return v && /^[0-9a-f]{32}$/.test(v) ? v : undefined;
}

// The state nonce is ALSO set as an HttpOnly cookie, so a callback must come
// from the same browser that started sign-in (login CSRF protection), not just
// carry any issued state string.
export const STATE_COOKIE = 'crewcode_oauth_state';
export function stateCookie(state: string, secure: boolean): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}
export function stateFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(STATE_COOKIE + '='));
  const v = m?.slice(STATE_COOKIE.length + 1);
  return v && /^[0-9a-f]{32}$/.test(v) ? v : undefined;
}

export function startGithubSignIn(cfg: AuthConfig | null): AuthResult {
  if (!cfg) return { status: 404, body: { ok: false, error: 'GitHub sign-in is not configured on this server.' } };
  const state = issueState();
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.callbackUrl, state });
  return { status: 302, location: 'https://github.com/login/oauth/authorize?' + q.toString(), setCookie: stateCookie(state, cfg.callbackUrl.startsWith('https:')) };
}

export async function finishGithubSignIn(cfg: AuthConfig | null, query: { code?: string; state?: string }, fetchImpl: FetchLike, appUrl = 'http://localhost:5177', cookieState?: string): Promise<AuthResult> {
  if (!cfg) return { status: 404, body: { ok: false, error: 'GitHub sign-in is not configured on this server.' } };
  if (!query.code || !query.state) return { status: 400, body: { ok: false, error: 'Missing code or state.' } };
  if (!cookieState || cookieState !== query.state) return { status: 400, body: { ok: false, error: 'State cookie mismatch. Start sign-in again in the same browser.' } };
  if (!consumeState(query.state)) return { status: 400, body: { ok: false, error: 'State mismatch. Start sign-in again.' } };
  let token: string;
  try {
    const r = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: query.code, redirect_uri: cfg.callbackUrl }),
    });
    const data = (await r.json()) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || !data.access_token) {
      return { status: 502, body: { ok: false, error: 'GitHub did not issue a token: ' + (typeof data.error === 'string' ? data.error : 'unexpected reply') } };
    }
    token = data.access_token;
  } catch {
    return { status: 502, body: { ok: false, error: 'Could not reach GitHub to exchange the code.' } };
  }
  try {
    const r = await fetchImpl('https://api.github.com/user', { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' } });
    const u = (await r.json()) as Record<string, unknown>;
    if (!r.ok || typeof u.login !== 'string' || typeof u.id !== 'number') return { status: 502, body: { ok: false, error: 'GitHub did not return a user profile.' } };
    // Handshake verified: bind the session to the immutable GitHub user id and
    // hand the browser back to the app with an HttpOnly session cookie.
    const s = createSession(u.id, u.login);
    return { status: 302, location: appUrl, setCookie: sessionCookie(s.id, cfg.callbackUrl.startsWith('https:')) };
  } catch {
    return { status: 502, body: { ok: false, error: 'Could not reach GitHub to read the profile.' } };
  }
}
