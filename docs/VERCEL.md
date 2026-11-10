# Vercel deployment design (2026-11-10, updated to the shipped adaptation)

Goal: the app at a stable Vercel link, auto-deploying from `main`, with GitHub
sign-in and durable shared state genuinely working. Free tier only, no new
accounts beyond the existing Vercel Hobby account and the existing GitHub App.

## What ships

- Static frontend: `npm run build` -> dist/ (verified: 294 kB JS / 89 kB gzip).
- API as Vercel functions: `api/index.ts` (POST /api), `api/auth/status.ts`,
  `api/auth/github/index.ts`, `api/auth/github/callback.ts`, `api/auth/logout.ts`.
  Filesystem routing - no rewrites. `vercel.json` pins build + output.
- Storage: GitHub Contents API on a PRIVATE repo (`CREWCODE_DATA_REPO`, e.g.
  bala-builds/crewcode-data), written by the CrewCode GitHub App installation
  token. `state.json` holds app state; `auth.json` holds sessions and consumed
  OAuth nonces. Every write is compare-and-swap on the file sha; a 409 re-reads
  and re-applies the SAME request on fresh bytes (bounded, 3 tries). The public
  code repo never carries app state, chats, sessions or keys.
- App auth: RS256 JWT minted from the App private key (env, raw PEM or base64 via
  vault) -> installation token (1 h, cached per warm instance).
- User auth: the dev server's guarantees kept across cold starts -
  - OAuth state: HMAC-signed (forgeries fail before any storage read), bound to
    the browser by the HttpOnly state cookie, 10-minute expiry, and DURABLY
    one-time: the nonce is recorded in auth.json via CAS on first use; a replay
    from any instance is rejected.
  - Sessions: unguessable 32-hex id in an HttpOnly SameSite=Lax cookie (Secure
    on https), 7-day expiry, stored durably, so logout/revocation really works.
  - Deployment always runs in the REQUIRE_AUTH posture: no test identities.
    The server rebinds `as` from the session, never from the client.
- Preview: unchanged - real sandboxed iframe executing the built plain JS with
  the fetch/handler bridge. BUILDS are the deterministic simulated builder;
  the Preview that runs their output is real. Do not conflate the two.

## Honest limits (v1)

- Needle suggestions: DISABLED in this deployment (the Python sidecar cannot
  run in a Vercel Node function). The UI labels suggestions unavailable; the
  API returns a clean error. This is a future capability, not integrated.
- No real multi-language builds/packages/databases; builds are the
  deterministic local builder. Per-project private code repos with feature-
  branch review semantics are a roadmap item - v1 keeps app state private in
  the data repo, code in the public app repo.
- Every API request costs GitHub API reads (state.json + auth.json): the
  installation token budget is 5,000 requests/hour, and the 4 s version poll is
  ~900/hour per open client. Fine for a private beta; not yet multi-tenant.
- Cold-start latency: each request re-reads state from GitHub (~200-400 ms
  added). No cross-instance caching in v1.
- Rate limiting: the dev server's in-memory limiter is per-instance and not
  meaningful serverless; v1 relies on auth-required POSTs, the 1 MB body cap,
  and Vercel/GitHub platform limits. Documented, not hidden.
- Function duration: verified against current Vercel docs (2026-11-10): Hobby
  allows 300 s default AND maximum (fluid compute). The deterministic build
  path fits easily; a future live build provider must stay under 300 s.

## Deployment setup (agent-executed; user has no steps unless a login wall appears)

1. Create private repo `crewcode-data` under bala-builds.
2. Install the CrewCode GitHub App on it with Contents read/write.
3. Generate the App private key on the app settings page; it goes straight to
   the vault (PEM never in chat, never in the repo).
4. Create the Vercel project from bala-builds/crewcode-mobile (auto-deploy from
   main), set env vars: CREWCODE_GITHUB_CLIENT_ID/SECRET, CREWCODE_GITHUB_APP_ID,
   CREWCODE_GITHUB_APP_PRIVATE_KEY (raw PEM; _B64 base64 form also accepted),
   CREWCODE_GITHUB_APP_INSTALLATION_ID,
   CREWCODE_DATA_REPO, CREWCODE_SESSION_SECRET, CREWCODE_APP_URL.
5. Update the OAuth callback URL to https://<deployment>/api/auth/github/callback.
6. Verify end-to-end: sign-in round-trip, project create/persist across cold
   starts, logout revocation, mobile viewport + PWA installability.

Tests: tests/serverless.test.ts (12 tests) covers JWT shape/verification,
installation-token caching, CAS round-trip/conflict/retry, durable one-time
state, cross-instance sessions, logout revocation, handler auth posture, and
identity rebinding.
