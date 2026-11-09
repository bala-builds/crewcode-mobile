# CrewCode bug log

| # | Phase | Issue | Evidence | Fix | Retest |
|---|-------|-------|----------|-----|--------|
| 1 | 3 | Simulated planner assigned a task and folder to the owner, displacing the teammate's frontend folder | failing test in tests/flows.test.ts | Plan for teammates only | 26 tests pass |
| 2 | 1 | Wrong test assertion for `frontend2/` vs `frontend/` prefix | failing test | Corrected assertion; prefix check matches whole path segments | pass |
| 3 | UI | "+ Add" button wrapped onto two lines at 360px | shots/seeta-chat-360.png (before) | Label changed to "Add" | re-screenshot |
| 4 | UI | Teammate Code tab opened a read-only file first instead of their own folder | shots/seeta-code-360.png (before) | Default to first editable file | re-screenshot |

Visual checks: 390 and 360 px wide, all tabs and both sheets, no horizontal page overflow found after fixes 3 and 4. Long file names scroll inside their own strip. Keyboard behaviour on a real phone is not yet checked.
