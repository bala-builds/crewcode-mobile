# Acceptance status

Legend: **Met** = built and tested. **Demo** = works only as a simulation or client-side prototype. **Not built**.
Phase numbers follow the private phase plan; names here describe what each area covers in this repo.

| Area | Criterion | Status | Evidence |
|---|---|---|---|
| Permissions (Ph 1-2) | One function decides read/write by role and folder; path tricks (`..`, prefixes) refused | Met (logic) | tests/permissions.test.ts |
| Permissions | Enforced where the client cannot bypass it | Met for the local dev API, Not built for a hosted server | src/server/api.ts, tests/api.test.ts (5 tests: probing, redaction, owner-only ops, folder refusal) |
| Teams (Ph 2) | Team code create, join, regenerate, revoke, remove member | Met (logic) | tests/flows.test.ts |
| Project files | PRD, agent instructions, contract saved in project root | Met (logic) | tests/flows.test.ts |
| Tasks (Ph 3) | AI splits work by interest, teammates only, one folder each | Demo (rule-based planner, no real AI) | src/core/orchestrator.ts |
| Build (Ph 3-4) | Teammate runs a build and files land only in their folder | Demo (generated placeholder files) | simulateBuild |
| Chat UI | Owner and teammate chat, error with retry, code button | Demo | docs/screenshots |
| Skills / MCP (Ph 4) | Search, add, owner approval | Demo (placeholder catalog, nothing installed) | src/core/skills.ts |
| Preview | Sandboxed preview of frontend file | Demo (static iframe, no runtime) | UI Preview tab |
| Providers (Ph 5-6) | Real Gemini/NVIDIA/Grok/Claude/GPT calls with owner or own key | **Not built.** Needs a provider key the owner has not approved | - |
| Key handling | Keys memory-only, masked, never saved | Met in the client prototype; server-side key use not built | src/core/providers.ts |
| Storage (Ph 8) | Durable code storage and metadata store | Local JSON file for the dev API only. Hosted storage/DB Not built (needs approval per change) | server/index.ts |
| Preview runtime (Ph 8) | Run teammates' code safely | Not built | - |
| Auth (Ph 10) | Name + username/password sign-in | Not built (last by instruction) | test identities only |
| Mobile | Phone keyboard, safe areas, real device | Not checked. Headless 360/390 px screenshots only | BUGLOG.md |
| Native vs web | Decision O3 | Open | - |

Do not deploy this publicly before authentication and a hosted server exist.
