# Two-contribution combined-runtime E2E

`two-contrib-merge.mjs` drives three real Chrome instances (separate profiles) against the
app served over HTTP: the owner (Ram) and two teammates (Seeta and Hanuma, who joins with
the demo team code). Work is divided by feature: Seeta owns home/ and Hanuma owns
settings/ (seed PRD feature list). Every project action goes through the real UI:

- the owner assigns both tasks;
- Seeta runs a simulated build, replaces `home/index.html` in the Code editor with
  `e2e/fixtures/frontend/index.html` (a page that lists and adds habits over `API_BASE`),
  then creates the five fixture backend files from `e2e/fixtures/backend/` one by one in
  `home/` with the Code tab's New file affordance (her feature owns its frontend and its
  backend together), fills each in the editor, marks done and submits;
- Hanuma runs a simulated build in `settings/` (full-stack placeholder), marks done and
  submits;
- the owner waits until both submissions are visible, runs the contract check on each
  folder and merges each into `main/`;
- the script verifies the physical `main/` tree byte-matches the fixtures, extracts it,
  boots the merged `main/home/` backend and serves the merged `main/home/index.html` with
  an `/api` proxy, then adds a habit through the merged page and confirms the merged
  backend stored it.

No AI calls, no Drive, no external services. The fixture backend is the ASCII-sanitized
copy of the backend generated in the earlier Groq live-call test (emoji/non-ASCII comment
characters replaced; logic unchanged).

## Run

From the repo root, with Chrome and a puppeteer-core install available (same convention as
`scripts/browser-e2e.mjs`):

```
CREWCODE_BROWSER_DRIVER=/path/to/puppeteer-core node e2e/two-contrib-merge.mjs
```

The script installs the fixture backend's npm dependencies on first run (local dev only)
and writes screenshots to `shots/http-e2e/34*.png`.

## Evidence from the 10 Nov 2026 run

- 34a: teammate Code tab with the New file affordance.
- 34b: owner sees BOTH submissions before merging (the script explicitly waits for both;
  an earlier run's shot 32b was taken before the owner's poll refreshed and was withdrawn
  as evidence).
- 34c: both folders merged.
- 34f: the merged app running; "Drink water" added through the merged frontend and read
  back from the merged backend (GET /api/v1/habits returned exactly that one habit).

Honest scope: the contract check verifies shared names only; it does not verify interface
compatibility across files. The combined runtime above is the compatibility evidence for
this fixture pair, not a general guarantee. Browser-emulated mobile viewports on localhost;
no real phone, no real AI generation in this run.
