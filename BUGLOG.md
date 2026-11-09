# CrewCode bug log

| # | Phase | Issue | Evidence | Fix | Retest |
|---|-------|-------|----------|-----|--------|
| 1 | 3 | Simulated planner assigned a task and folder to the owner, displacing the teammate's frontend folder | failing test in tests/flows.test.ts | Plan for teammates only | 26 tests pass |
| 2 | 1 | Wrong test assertion for `frontend2/` vs `frontend/` prefix | failing test | Corrected assertion; prefix check matches whole path segments | pass |
| 3 | UI | "+ Add" button wrapped onto two lines at 360px | shots/seeta-chat-360.png (before) | Label changed to "Add" | re-screenshot |
| 4 | UI | Teammate Code tab opened a read-only file first instead of their own folder | shots/seeta-code-360.png (before) | Default to first editable file | re-screenshot |

Visual checks: 390 and 360 px wide, all tabs and both sheets, no horizontal page overflow found after fixes 3 and 4. Long file names scroll inside their own strip. Keyboard behaviour on a real phone is not yet checked.

| 5 | 1 | Tab position reset when leaving and re-entering a project | code read + tabMemory added | Remember last tab per project in memory | ui.test.tsx tap-through: tab survives Back and re-enter |
| 6 | 1 | Typed composer text lost when going Back from a project | ui.test.tsx tap-through (failed before fix) | Remember draft per project in memory | ui.test.tsx: draft survives Back and re-enter |

Phase 1 keyboard check, what it is: pages rendered at 360x420 and 390x420 to imitate a viewport squeezed by a keyboard. Header, composer and tabs stay visible and nothing overflows sideways (shots/kb-*.png, local only). This is NOT a real phone keyboard test: no iOS/Android keyboard, no safe-area insets, no browser address-bar resize. Still unverified.

Phase 3 checks (10 Nov): edited code is what the preview shows and the preview iframe is sandboxed (tests/ui.test.tsx). A crashing preview page that also tries to overwrite the parent document does not touch the app: the iframe runs as an opaque origin with scripts only, the app stays intact (shots/phase1/15-preview-crash-isolated.png, local only). A 61-message chat scrolls with the composer and tabs pinned, no sideways overflow (shots/phase1/14-long-chat.png, local only).

Phase 4 rule-removal checks (10 Nov): each access rule in src/core/permissions.ts was removed one at a time and the suite re-run. Every removal made at least one test fail: outsider block, path-traversal refusal, root files read-only for teammates, folder scoping, task visibility scoping, message visibility scoping. No rule is untested.


## Connected UI / Phase 9, 10 Nov

| # | Phase | Issue | Fix | Retest |
|---|-------|-------|-----|--------|
| 7 | 2-4 | Identity switch briefly rendered stale project cards and crashed when no member row matched | Guard stale member lookup | Async UI suite and two-context Chrome journey pass |
| 8 | 9 | Offline initial user-list load failed silently, leaving no identity buttons | Visible error with Retry connection; client bounds fetch to 10s | browser-e2e offline screenshot and client.test.ts |
| 9 | 9 | API accepted any media type and had no friendly oversized/rate response | Require JSON, validate envelope, 1 MB byte cap, 300/min loopback cap, 15s request timeout | hardening.test.ts; iframe simple POST mutation refused |
| 10 | 8-9 | Preview banner implied a stronger data/key boundary than established | Narrow banner: opaque-origin, network not blocked, not secure for untrusted code | Browser probes parent/storage/CORS and confirms simple POST cannot mutate API; no broad isolation claim |

Browser E2E: scripts/browser-e2e.mjs runs actual UI -> HttpClient -> Vite proxy -> real API binary. Two browser contexts, temporary JSON data. 47 requests observed including boundary probes. 390x844 screenshots inspected. Cross-session updates still need re-entry/reload; live sync not built. Real phone keyboard not tested.
