# CrewCode (mobile prototype)

A chat-first app where a team builds software together. The owner writes a master prompt, shares a team code, and a simulated AI splits the work so each teammate sees and edits only their own folder.

## Status: prototype, not the finished product
**Real:** the rules. One permission function (`src/core/permissions.ts`) decides who can read or write which path. Team codes, interests, task planning, shared contract checks, owner-AI sharing, skill approval and local save are all tested (`npm test`).

**Simulated:** all AI answers and builds, the preview (a sandboxed iframe of a generated page), skills and MCP catalog (placeholder names, nothing installed).

**Not built:** real AI providers (Phases 5-6, needs keys the owner has not approved), real storage and a preview runtime (Phase 8), and authentication (Phase 10, built last). Provider names Gemini, NVIDIA, Grok, Claude and GPT are placeholders and are not verified integrations.

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
