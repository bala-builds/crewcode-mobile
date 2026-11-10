# Acceptance status

Legend: **Met** = built and tested. **Demo** = works only as a simulation or client-side prototype. **Not built**.
Phase numbers follow the private phase plan; names here describe what each area covers in this repo.

| Area | Criterion | Status | Evidence |
|---|---|---|---|
| Mobile screens (Ph 1) | Full owner and teammate journeys, empty/loading/error/restricted states, buttons lead somewhere or say unavailable, text and tab survive Back | Met with mock data; real phone tap-through and real keyboard still unverified | tests/ui.test.tsx (7 tap-through tests), 360/390px screenshots; bugs 5-6 fixed and retested |
| Permissions (Ph 1-2) | One function decides read/write by role and folder; path tricks (`..`, prefixes) refused | Met (logic) | tests/permissions.test.ts |
| Permissions | Enforced where the client cannot bypass it; every access rule has a test that fails if the rule is removed | Met for the local dev API, Not built for a hosted server | src/server/api.ts, tests/api.test.ts; rule-removal run 10 Nov in BUGLOG.md |
| Teams (Ph 2) | Team code create, join, regenerate, revoke, remove member | Met (logic) | tests/flows.test.ts |
| Project files | PRD, agent instructions, contract saved in project root | Met (logic) | tests/flows.test.ts |
| Tasks (Ph 3) | AI splits work by interest, teammates only, one folder each | Demo (rule-based planner, no real AI) | src/core/orchestrator.ts |
| Merge (Ph 6, F6) | Accepted work is copied into main/<folder>/; owner-only tree; owner edits to a merged copy block the next merge until explicitly overwritten; staleness and mismatch rules still bind | Met (local) | tests/merge-main.test.ts, review.test.ts; shots 27/27b |
| Build (Ph 3-4) | Teammate runs a build and files land only in their folder | Demo (generated placeholder files) | simulateBuild |
| Chat UI | Owner and teammate chat, error with retry, code button | Demo | docs/screenshots |
| Skills / MCP (Ph 4) | Search, add, owner approval | Real-item catalog (named tools mapped to sources; local tools run, external items noted not runnable) | src/core/skills.ts |
| Preview | Real web-file runtime: the actual file runs with scripts in an opaque-origin iframe; edited code is what the preview shows; script execution and parent/storage denial proven in real Chrome | Met (web output only; network not blocked; not a secure untrusted-code runtime) | tests/ui.test.tsx preview checks, shot 25 (script probe markers) |
| Providers (Ph 5-6) | Real provider calls with an own key | Met for own keys: adapters for Gemini, NVIDIA, xAI Grok, Groq, Claude, GPT call official endpoints from the device with the memory-only key; full build/plan flows tested against a fake fetch (scope refusal, stop-discard, error mapping). Owner-model real use stays gated on server-side key storage. **No live call made.** | src/core/llm.ts, src/core/providers.ts, tests/llm.test.ts, tests/realai.test.ts, ui.test.tsx; shot 28 |
| Key handling | Keys memory-only, masked, never saved | Met in the client prototype; server-side key use not built | src/core/providers.ts |
| Storage (Ph 8) | Durable code storage and metadata store | Local JSON file for the dev API only. Hosted storage/DB Not built (needs approval per change) | server/index.ts |
| Preview runtime (Ph 9/O3) | Run teammates' code safely | Met for web output (opaque-origin iframe, isolation probe-proven); server-side runtime for other project types stays open (O3) | shot 25 |
| Auth (Ph 10) | Name + username/password sign-in | Not built (last by instruction) | test identities only |
| Mobile | Phone keyboard, safe areas, real device | Not checked. Headless 360/390 px screenshots only | BUGLOG.md |
| Decisions (Ph 0) | One-page decision record, every open decision answered or deferred with a reason | Met | DECISIONS.md; native vs web stays open, live provider use deferred pending approval |

Do not deploy this publicly before authentication and a hosted server exist.

## Working-flow test (owner to teammate)
`tests/e2e.test.ts` runs create project, invite code, wrong code refused, two teammates join, AI plan, build, edit own folder, refused outside folder, teammate view hides other folders, revoke code, remove member. It runs through the server-side API with test identities.

Counts as working: team code lifecycle, joining, folder isolation, per-user redaction, saves, removal.
Does **not** count as working: task planning and builds (rule-based simulation), any real AI call, and authentication (excluded). The preview genuinely runs web files; the skills/MCP catalog maps named tools to real sources. The phone UI is wired to the local API. A real Chrome owner/teammate journey through HttpClient, Vite proxy and the server binary passed on 10 Nov (scripts/browser-e2e.mjs, 47 observed HTTP requests including iframe probes). Real-device tap-through remains untested.


## Local integration and hardening, 10 Nov

- Phases 2-4 local connected flow: **Met** in headless Chrome at 390x844, two isolated browser contexts. Create, join, assign, simulated build, file edit/save persisted to server JSON, teammate redaction, root read-only, edited HTML preview. No page errors or horizontal page overflow. UI refreshes on re-entry, not live cross-session streaming.
- Phase 7 tools: **Met for two deterministic local checks only**. Local shared-name check and Local secret scan can be added/approved/run/removed. Generic MCP installation and arbitrary tool execution **Not built**.
- Phase 8 backup/revisions: **Met locally** for owner-only export/restore and optimistic file revisions (unit/API/HTTP tests). Google Drive backup/sync and hosted database **Not built**, approval-gated.
- Phase 9 local transport hardening: **Met locally** for a 1 MB byte limit, 300 requests/minute loopback cap, JSON media-type/request-shape validation, request timeouts, no-store responses and friendly offline UI. Not hosted-service abuse protection. Tests: hardening.test.ts and client.test.ts. Full suite: 78 tests, 13 files.
- Preview: opaque iframe blocks parent DOM/storage access in the tested browser, and JSON CORS requests to the local API are refused. Simple iframe POST cannot mutate the API because non-JSON media types are rejected. Network access itself is **not blocked**; preview is **not a secure runtime for untrusted code**. Banner says so. General crash/resource exhaustion isolation is not proven.
- Secret review: no actual provider keys in tracked source. The gsk_ fixture in tests is fake. No live AI calls, CI runs, deployments, new accounts, or database migrations were made.

Screenshots under shots/http-e2e are local, git-ignored: owner plan, teammate saved code, preview and offline error. This is desktop Chrome with a mobile viewport, not a phone keyboard/safe-area test.
