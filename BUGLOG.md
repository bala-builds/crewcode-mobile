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
