# CrewCode QA bug log

Format: id | found | area | issue | evidence | fix | retest.

| id | date | area | issue | evidence | fix | retest |
|----|------|------|-------|----------|-----|--------|
| B1 | 2026-11-10 | tests | Right-rail "Manage" click opened the wrong surface: two buttons share the label (AI & tools vs Team) | tests/tabs.test.tsx sidebar test: activeTab was Tasks, expected Team | Test scopes the click to the Team card | tabs.test.tsx "right sidebar counters" green |
| B2 | 2026-11-10 | ui/mobile | Mobile Overview sheet first rendered the four context cards squeezed side-by-side at 390px | shots/design/60n first take (pixel-inspected) | `.sheet .rrail` gets flex-direction: column | shots/design/60n re-take shows stacked cards |
| B3 | 2026-11-10 | docs | README claimed "updates from another session appear after reload; live sync is not built" - stale after the version-poll work | App.tsx Workspace polls getVersion every 4s and reloads preserving drafts; tests/sync-version.test.ts | Reported to docs owner; README correction queued | pending README edit |
| B4 | 2026-11-10 | release | A 32 KB file fill through the GitHub web editor committed corrupted bytes to main (tsc `}` error) | post-push byte-compare vs api.github.com contents; suite dropped to 35 collected tests | Re-pushed the file; main broken ~1 min between commits | full API byte-compare of all 5 files identical; 201/201 green |
| B5 | 2026-11-10 | release | grep-count verification passed on the corrupted store.ts (2 matches) - insufficient check | B4 investigation | Verification rule: full byte-compare after every editor fill; CodeMirror virtualizes long files so DOM textContent checks are unreliable | applied to B4 fix |
| B6 | 2026-11-10 | tasks | Due-date validation accepted impossible calendar dates (2026-13-99) when the format matched | tests/taskdetails.test.ts negative case (format-only regex) | setTaskDetails now round-trips through Date.UTC and rejects non-real dates | negative test expects the rejection |
| B7 | 2026-11-10 | tests | QA test initially read pre-mutation state (ops are immutable: mut() clones) | tests/taskdetails.test.ts first run: priority undefined after ok | Test reads r.state | 6/6 green |
| B8 | 2026-11-10 | builds | lineDiff counted an empty previous file as one removed line (''.split gives ['']) | tests/taskdetails.test.ts new-file case: removed 1 expected 0 | Empty before/after treated as zero lines | new-file and one-line-edit cases green |
