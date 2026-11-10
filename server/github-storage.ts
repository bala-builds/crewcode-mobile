// Durable storage over the GitHub Contents API. State lives in a PRIVATE repo
// (CREWCODE_DATA_REPO, e.g. "bala-builds/crewcode-data") written by the
// CrewCode GitHub App installation token. The public code repo never carries
// app state, chats, sessions or keys.
//
// Concurrency: every write is compare-and-swap on the file sha. A 409 means a
// concurrent writer won; the caller re-reads and retries (bounded). This is
// what lets many cold function instances share one durable state safely.
import type { AppState } from '../src/core/types';
import { Api, type ApiRequest, type ApiResponse } from '../src/server/api';
import type { AuthStore, AuthData } from './durable-auth';
import type { TokenFetch } from './github-app';

export interface ContentsCfg { repo: string; path: string; token: string }

const GH = 'https://api.github.com';

export async function readContents(f: TokenFetch, cfg: ContentsCfg, apiBase = GH): Promise<{ sha: string; text: string } | null> {
  const r = await f(`${apiBase}/repos/${cfg.repo}/contents/${cfg.path}`, { headers: { authorization: 'Bearer ' + cfg.token, accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  const d = (await r.json()) as Record<string, unknown>;
  if (!r.ok || typeof d.sha !== 'string' || typeof d.content !== 'string') throw new Error('Could not read ' + cfg.path + ' (status ' + r.status + ').');
  return { sha: d.sha, text: Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf8') };
}

export async function writeContents(f: TokenFetch, cfg: ContentsCfg, sha: string | null, text: string, message: string, apiBase = GH): Promise<'ok' | 'conflict'> {
  const body: Record<string, unknown> = { message, content: Buffer.from(text, 'utf8').toString('base64') };
  if (sha) body.sha = sha;
  const r = await f(`${apiBase}/repos/${cfg.repo}/contents/${cfg.path}`, {
    method: 'PUT', headers: { authorization: 'Bearer ' + cfg.token, accept: 'application/vnd.github+json', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 409) return 'conflict';
  if (!r.ok) throw new Error('Could not write ' + cfg.path + ' (status ' + r.status + ').');
  return 'ok';
}

/** Auth store (sessions + consumed OAuth nonces) as auth.json in the private repo. */
export function githubAuthStore(f: TokenFetch, cfg: Omit<ContentsCfg, 'path'>, apiBase = GH): AuthStore {
  const c = { ...cfg, path: 'auth.json' };
  return {
    async read() {
      const r = await readContents(f, c, apiBase);
      if (!r) return { sha: null, data: { sessions: {}, consumedStates: {} } };
      const d = JSON.parse(r.text) as Partial<AuthData>;
      return { sha: r.sha, data: { sessions: d.sessions ?? {}, consumedStates: d.consumedStates ?? {} } };
    },
    async write(sha, data) { return writeContents(f, c, sha, JSON.stringify(data), 'auth: update sessions/state nonces', apiBase); },
  };
}

/**
 * Run one API op against durable state.json with CAS retry. Each attempt reads
 * fresh state, runs the op on a new Api (cold-start semantics: no cross-request
 * memory), and writes only if the op mutated. A 409 re-reads and re-applies the
 * SAME request on the fresh state, so validation always runs against current
 * bytes. Ops are deterministic, so a retry cannot double-apply a build.
 */
export async function runServerlessOp(f: TokenFetch, cfg: Omit<ContentsCfg, 'path'>, input: ApiRequest, bind?: { githubId: number; login: string }, tries = 3, apiBase = GH): Promise<ApiResponse> {
  const c = { ...cfg, path: 'state.json' };
  for (let attempt = 1; attempt <= tries; attempt++) {
    const cur = await readContents(f, c, apiBase);
    let saved: AppState | null = null;
    const api = new Api(cur ? (JSON.parse(cur.text) as AppState) : undefined, (s) => { saved = s; });
    if (bind) {
      try { input = { ...input, as: api.ensureGithubUser(bind.githubId, bind.login) }; }
      catch { return { ok: false, error: 'Could not resolve the signed-in account.' }; }
    }
    const res = await api.callAsync(input);
    if (saved === null) return res; // read-only op (or failed before mutating)
    const wr = await writeContents(f, c, cur?.sha ?? null, JSON.stringify(saved), 'app: ' + input.op, apiBase);
    if (wr === 'ok') return res;
  }
  return { ok: false, error: 'State changed concurrently too many times. Retry.' };
}
