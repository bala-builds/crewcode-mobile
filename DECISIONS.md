# CrewCode decision record (Phase 0)

One page. Each open decision from the PRD is answered or marked deferred with a reason. Phase numbers follow the private phase plan. Written 10 Nov 2026. The O-list below was checked verbatim against the original PRD (`CrewCode-PRD.pdf`, Draft 1, 9 Nov 2026).

Status labels: **Owner-approved** means the user decided it. **Working choice** means the builder picked it to keep moving; the user has not approved it and it can change. **Deferred** means unanswered until its phase begins.

| # | Topic | Decision | Status |
|---|---|---|---|
| O1 | Reuse | Fresh mobile-first build. The earlier prototype (old repo and Drive backup) is preserved, not extended. | Working choice (matches the user's request to build the new mobile app; not explicitly approved) |
| O3 | Platform and preview runtime | Mobile-first web app (Vite + React, 360/390px targets). Preview runs as a sandboxed iframe (`sandbox="allow-scripts"`), scripts only, no app data or keys. Tested failure class is narrow: a render-time JS exception in preview code does not crash the app shell. The sandbox attribute does not block network access and is not a complete security boundary. A real preview runtime is deferred to Phase 8. Native vs web is still open. | Working choice; native-vs-web open |
| O4 | Providers | Provider adapter and safety rules built against a fake fetch (call cap, keys never in errors). No live provider call yet; using any real key needs the user's approval first. Past preference in the TeamCode context was Groq free tier, but that approval was task-scoped and does not carry over. | Deferred: needs user approval before any live call |
| O9 | Where code lives | The user's own Google Drive, per his explicit decision (3 Nov 2026). This build currently stores code in local state and a git-ignored dev JSON file; Drive sync is not built yet. | Owner-approved; Drive sync not built (Phase 8) |
| O2, O5-O8, O10, O11 | Remaining PRD decisions | Deferred: their phases have not started. Each gets answered when its phase begins, and nothing here needs a paid plan or a card. | Deferred |

Ground rules kept while building: no paid plan or card required so far; test identities only (not a login); no public deployment before Phase 10 authentication; database changes and CI runs each need explicit approval first.
