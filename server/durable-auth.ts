// Durable auth for the serverless deployment. The dev server keeps OAuth state
// nonces and sessions in process memory; a function fleet cannot. These
// primitives keep the SAME guarantees across cold starts by persisting both in
// auth.json in the private data repo, written compare-and-swap:
//   - OAuth state: one-time use, 10-minute expiry, bound to the browser by the
//     state cookie, and now also HMAC-signed so a forged value fails before any
//     storage read. Replay is rejected durably, not per-instance.
//   - Sessions: 7-day expiry, unguessable 32-hex id in an HttpOnly cookie, and
//     logout/revocation actually works because the record is deleted from
//     durable storage. No security property of the dev server is weakened.
import { createHmac, getRandomValues, timingSafeEqual } from 'node:crypto';

export interface Session { id: string; githubId: number; login: string; createdAt: number; expiresAt: number }
export interface AuthData { sessions: Record<string, Session>; consumedStates: Record<string, number /* expiresAt */> }
export interface AuthStore {
  read(): Promise<{ sha: string | null; data: AuthData }>;
  write(sha: string | null, data: AuthData): Promise<'ok' | 'conflict'>;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const newToken = () => [...getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** CAS mutation loop: re-read and re-apply fn on conflict, bounded. */
export async function mutateAuth<T>(store: AuthStore, fn: (data: AuthData) => T | undefined, tries = 4): Promise<T | 'conflict'> {
  for (let i = 0; i < tries; i++) {
    const { sha, data } = await store.read();
    data.consumedStates = data.consumedStates ?? {};
    data.sessions = data.sessions ?? {};
    const out = fn(data);
    if (out === undefined) return 'conflict'; // fn declined (e.g. replay): no write
    const wr = await store.write(sha, data);
    if (wr === 'ok') return out;
  }
  return 'conflict';
}

const sign = (v: string, secret: string) => createHmac('sha256', secret).update(v).digest('base64url');

/** Signed OAuth state: nonce.expiry.signature. The cookie carries this whole value. */
export function issueSignedState(secret: string, now = Date.now()): string {
  const base = newToken() + '.' + (now + STATE_TTL_MS);
  return base + '.' + sign(base, secret);
}

/** Signature + expiry check only; one-time use is enforced by consumeStateDurable. */
export function verifySignedState(state: string, secret: string, now = Date.now()): string | null {
  const parts = state.split('.');
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const base = parts[0] + '.' + parts[1];
  const a = Buffer.from(sign(base, secret)), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (now >= Number(parts[1])) return null;
  return parts[0];
}

/** Durable one-time consume: returns true exactly once per nonce, across instances. */
export async function consumeStateDurable(store: AuthStore, nonce: string, now = Date.now()): Promise<boolean> {
  const r = await mutateAuth(store, (d) => {
    for (const [n, exp] of Object.entries(d.consumedStates)) if (now >= exp) delete d.consumedStates[n]; // GC
    if (d.consumedStates[nonce] !== undefined) return undefined; // replay
    d.consumedStates[nonce] = now + STATE_TTL_MS;
    return true as const;
  });
  return r === true;
}

export async function createSessionDurable(store: AuthStore, githubId: number, login: string, now = Date.now()): Promise<Session | 'conflict'> {
  const s: Session = { id: newToken(), githubId, login, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  const r = await mutateAuth(store, (d) => { d.sessions[s.id] = s; return s; });
  return r === 'conflict' ? 'conflict' : r;
}

/** Read-only; expired sessions are treated as absent and GC'd on the next write. */
export async function getSessionDurable(store: AuthStore, id: string | undefined, now = Date.now()): Promise<Session | null> {
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return null;
  const { data } = await store.read();
  const s = (data.sessions ?? {})[id];
  return s && now < s.expiresAt ? s : null;
}

/** Logout/revocation: the record is deleted from durable storage. */
export async function destroySessionDurable(store: AuthStore, id: string | undefined, now = Date.now()): Promise<void> {
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return;
  await mutateAuth(store, (d) => {
    for (const [sid, s] of Object.entries(d.sessions)) if (now >= s.expiresAt) delete d.sessions[sid]; // GC
    delete d.sessions[id];
    return true as const;
  });
}
