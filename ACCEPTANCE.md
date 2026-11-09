# Acceptance status

Legend: **Met** = built and tested. **Demo** = works only as a simulation or client-side prototype. **Not built**.
Phase numbers follow the private phase plan; names here describe what each area covers in this repo.

| Area | Criterion | Status | Evidence |
|---|---|---|---|
| Mobile screens (Ph 1) | Full owner and teammate journeys, empty/loading/error/restricted states, buttons lead somewhere or say unavailable, text and tab survive Back | Met with mock data; real phone tap-through and real keyboard still unverified | tests/ui.test.tsx (4 tap-through tests), 360/390px screenshots; bugs 5-6 fixed and retested |
| Permissions (Ph 1-2) | One function decides read/write by role and folder; path tricks (`..`, prefixes) refused | Met (logic) | tests/permissions.test.ts |
| Permissions | Enforced where the client cannot bypass it; every access rule has a test that fails if the rule is removed | Met for the local dev API, Not built for a hosted server | src/server/api.ts, tests/api.test.ts; rule-removal run 10 Nov in BUGLOG.md |
| Teams (Ph 2) | Team code create, join, regenerate, revoke, remove member | Met (logic) | tests/flows.test.ts |
| Project files | PRD, agent instructions, contract saved in project root | Met (logic) | tests/flows.test.ts |
| Tasks (Ph 3) | AI splits work by interest, teammates only, one folder each | Demo (rule-based planner, no real AI) | src/core/orchestrator.ts |
| Build (Ph 3-4) | Teammate runs a build and files land only in their folder | Demo (generated placeholder files) | simulateBuild |
| Chat UI | Owner and teammate chat, error with retry, code button | Demo | docs/screenshots |
| Skills / MCP (Ph 4) | Search, add, owner approval | Demo (placeholder catalog, nothing installed) | src/core/skills.ts |
| Preview | Sandboxed preview of frontend file; edited code is what the preview shows; a crashing preview does not crash the app; long chats scroll | Demo (static iframe, no runtime) | tests/ui.test.tsx preview checks, shots/phase1/14-15 (local) |
| Providers (Ph 5-6) | Real provider calls with owner or own key | Adapter + safety tests built against a fake fetch (call cap, no key in errors, 401/402/429 handling). **No live call made.** Needs approved key use | src/core/llm.ts, tests/llm.test.ts |
| Key handling | Keys memory-only, masked, never saved | Met in the client prototype; server-side key use not built | src/core/providers.ts |
| Storage (Ph 8) | Durable code storage and metadata store | Local JSON file for the dev API only. Hosted storage/DB Not built (needs approval per change) | server/index.ts |
| Preview runtime (Ph 8) | Run teammates' code safely | Not built | - |
| Auth (Ph 10) | Name + username/password sign-in | Not built (last by instruction) | test identities only |
| Mobile | Phone keyboard, safe areas, real device | Not checked. Headless 360/390 px screenshots only | BUGLOG.md |
| Decisions (Ph 0) | One-page decision record, every open decision answered or deferred with a reason | Met | DECISIONS.md; native vs web stays open, live provider use deferred pending approval |

Do not deploy this publicly before authentication and a hosted server exist.

## Working-flow test (owner to teammate)
`tests/e2e.test.ts` runs create project, invite code, wrong code refused, two teammates join, AI plan, build, edit own folder, refused outside folder, teammate view hides other folders, revoke code, remove member. It runs through the server-side API with test identities.

Counts as working: team code lifecycle, joining, folder isolation, per-user redaction, saves, removal.
Does **not** count as working: task planning and builds (rule-based simulation), preview, skills, any real AI call, and authentication (excluded). The phone UI is not yet wired to this API, so the full tap-through flow on a device is still untested.
