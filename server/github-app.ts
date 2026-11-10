// GitHub App authentication for the serverless deployment. The App's private
// key arrives only via CREWCODE_GITHUB_APP_PRIVATE_KEY (base64-encoded PEM,
// delivered through the vault - never code, chat or the repo). From it we mint
// a short-lived RS256 JWT (10 min max per GitHub) and exchange it for an
// installation access token (1 h), cached per warm function instance.
import crypto from 'node:crypto';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * The app private key arrives as CREWCODE_GITHUB_APP_PRIVATE_KEY (raw PEM, as
 * pasted from the .pem download; env UIs often keep literal "\n" sequences)
 * or the base64 form CREWCODE_GITHUB_APP_PRIVATE_KEY_B64. A value without a
 * PEM header is treated as base64.
 */
export function resolvePrivateKeyPem(env: Record<string, string | undefined>): string | null {
  const v = (env.CREWCODE_GITHUB_APP_PRIVATE_KEY ?? env.CREWCODE_GITHUB_APP_PRIVATE_KEY_B64)?.trim();
  if (!v) return null;
  const unescaped = v.replace(/\\n/g, '\n');
  return unescaped.includes('-----BEGIN') ? unescaped : Buffer.from(unescaped, 'base64').toString('utf8');
}

export function appJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60; // clock-skew allowance
  const payload = { iat, exp: iat + 600, iss: appId };
  const data = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(payload));
  return data + '.' + crypto.sign('sha256', Buffer.from(data), privateKeyPem).toString('base64url');
}

export interface TokenFetch {
  (url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

export class InstallationTokens {
  private cached: { token: string; expiresAt: number } | null = null;
  constructor(private appId: string, private installationId: string, private privateKeyPem: string, private fetchImpl: TokenFetch, private apiBase = 'https://api.github.com') {}
  async token(now = Date.now()): Promise<string> {
    if (this.cached && now < this.cached.expiresAt - 60_000) return this.cached.token;
    const r = await this.fetchImpl(`${this.apiBase}/app/installations/${this.installationId}/access_tokens`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + appJwt(this.appId, this.privateKeyPem, now), accept: 'application/vnd.github+json' },
    });
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok || typeof d.token !== 'string') throw new Error('GitHub did not issue an installation token (status ' + r.status + ').');
    this.cached = { token: d.token, expiresAt: typeof d.expires_at === 'string' ? Date.parse(d.expires_at) : now + 3_600_000 };
    return d.token;
  }
}
