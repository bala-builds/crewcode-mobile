# CrewCode (mobile prototype)

A chat-first app where a team builds software together. The owner writes a master prompt, shares a team code, and a simulated AI splits the work so each teammate sees and edits only their own folder.

## Status: prototype, not the finished product
**Real:** the rules. One permission function (`src/core/permissions.ts`) decides who can read or write which path. Team codes, interests, task planning, shared contract checks, owner-AI sharing, skill approval and local save are all tested (`npm test`).

**Simulated:** AI answers and builds unless you add your own API key in the AI screen. The skills/MCP catalog maps the named tools to verified official sources (Claude Design = Anthropic's hosted design feature, not installable; cloudflare security = Cloudflare's API MCP server); the local tools really run.

**Real with your own key:** all five named providers (Gemini, NVIDIA, Grok, Claude, GPT) have live adapters to their official endpoints; the key stays in memory on your device and calls go straight from your device to the provider. "Grok" asks you to pick xAI Grok or Groq (the name covers both; nothing assumed). Teammates on the owner's model still get simulated answers: real owner-key sharing needs server-side key storage, which waits for sign-in.

**Real:** accepted work merges into an owner-only `main/` tree (`main/<folder>/<name>`), gated by the contract check; a merged copy the owner edited is never silently overwritten.

**Real:** the preview runs the actual web file with scripts on in an opaque-origin iframe (no access to the app or its storage; network not blocked; not a secure runtime for untrusted code), and local tools run through a genuine MCP stdio server in a permission-restricted process.

**Not built:** owner-key sharing with a real key (needs server-side key storage, approval-gated), real Drive storage (Phase 9: upload code path built but inert - this build has no confirmed Google OAuth client ID), and authentication (Phase 11, built last). A live Groq free-tier call was verified on 10 Nov 2026 (2 user-approved requests, browser-direct from the app UI, key held memory-only from the vault); all other providers are adapter-tested against a fake fetch only. The skills/MCP catalog maps named tools to verified official sources, but the two named external items are not runnable in this build, so that integration is incomplete (O8).

## Important limits
- No real sign-in. You pick a test identity (Ram, Seeta, Hanuma, Outsider) or register a name. This is not a login.
- Permissions are enforced in client code here. A real release must enforce them on a server.
- API keys typed in the AI screen stay in memory only. Use throwaway keys. Nothing is sent anywhere.
- Do not deploy this publicly before authentication exists.
- Stack is a mobile-web prototype (Vite, React, TypeScript). `src/core` has no UI or browser dependency so it can move to React Native later. Native vs mobile web is still an open decision.

## Local dev API
`npm run server` starts a local API on 127.0.0.1:8787 that applies the permission rules on the server side and returns only what each caller may see. It uses test identities, saves to a git-ignored `server/data.json`, and is not for public deployment. The UI does not call it yet. See `ACCEPTANCE.md` for what is met, demo-only or not built.

## Run
```
npm install
npm run dev      # then open on a phone-sized window
npm test
npm run build
```
Screenshot helper: open `/#demo=ram&tab=chat` or `/#demo=seeta&tab=code` (seeded test data, not saved).

## Layout
- `src/core` rules and simulated AI
- `src/ui` screens
- `tests` permission and flow tests
- `docs/screenshots` checked mobile views (360 and 390 px wide)
- `BUGLOG.md` bugs found and fixed


### Repeatable local browser check (no CI)

Start from the repository root. Requires installed Chrome at /usr/bin/google-chrome and an optional puppeteer-core driver. Keep that driver outside this app's dependencies if desired:

```sh
npm install --prefix /tmp/crewcode-browser-driver --no-audit --no-fund puppeteer-core
CREWCODE_BROWSER_DRIVER=/tmp/crewcode-browser-driver/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js node scripts/browser-e2e.mjs
```

The script builds and starts the local API and Vite on loopback ports 8787 and 5173, uses temporary JSON state, checks two isolated browser identities, and stops both processes. Ports must be free. It saves screenshots/report under shots/http-e2e (git-ignored). No provider calls or external account access. Browser viewport is 390x844, not a real-phone test.

Local limits: 1 MB/request, 300 API requests/minute per dev server, 15s request timeout. The phone UI needs both `npm run server` and `npm run dev`; Vite proxies /api to 127.0.0.1:8787. Without the API, it shows an error with retry. Updates from another session appear after re-entering the project or reloading; live sync is not built. Preview iframe is not a network firewall or a secure untrusted-code runtime. Do not deploy this unauthenticated development app publicly.
