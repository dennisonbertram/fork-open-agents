# Development log — STORY-158 after #1390 (2026-08-20)

## Done

- Merged #1390 into `develop` (`f1f918b4`).
- Probed Preview / Dev / Production for `GET /api/dev/test-auth`.
- Walked STORY-158 locally via the new bootstrap (2/2). Screenshots in
  `docs/ux-paths/browser/walk-story-158/`.
- Operator added `OPEN_AGENTS_ENABLE_TEST_AUTH=1` on Vercel
  `development` (2026-08-20 22:52 local). Reprobed: Dev still HTML 404
  on `dpl_4j7yWJeZCNtkPi5qGJjZUiNPL2C5`. Production unchanged.
- Operator `vercel target list` (2026-08-20 ~21:17 UTC): `dev` exists,
  tracks `develop`, type Preview, Updated **80d**. Paste stopped after
  the list; no env-add success and no `deploy --target=dev`. Reprobe
  21:20 UTC still the old Dev deploy.
- Operator `vercel env ls dev` (~21:25 UTC):
  `OPEN_AGENTS_ENABLE_TEST_AUTH` is Encrypted, environments `dev`, 7m
  ago. Reprobe still HTML 404 on `dpl_4j7yWJe…`. Deploy is the remaining
  step.
- Operator `git pull` on `~/dev/open-agents` `develop` aborted: local
  `kanban.json` would be overwritten. Checkout is still `36f2caf3`, not
  `f1f918b4`. Stash/discard kanban, pull, then deploy.

## Incorrect assumptions

1. Assumed merge to `develop` would immediately update the Dev URL — it
   still served HTML 404 (`x-matched-path: /404`) on the previous deploy id.
2. Assumed this VM could set the Dev env var — no Vercel token, CLI logged
   out. Slice 5 stays operator-owned.
3. Assumed Preview would already have the stale test-auth flag — Preview
   has the new route and returns JSON 404 (flag off).
4. Assumed `vercel env add … development` arms the stable Dev URL.
   Wrong: that is Vercel’s built-in Development scope. The URL
   `open-agents-env-dev-…` is the custom environment named `dev`.
5. Assumed `dev` branch-tracking `develop` would deploy on merge.
   Wrong: `vercel target list` shows `dev` Updated **80d**. A merge to
   `develop` is not a Dev deploy.

## Global learnings

- Preview JSON 404 vs Dev HTML 404 is the difference between “route
  deployed, flag off” and “old build, route missing”.
- Local `GET /api/dev/test-auth?next=/sessions` is enough to walk
  authenticated catalog stories without mocking connection-status.
- `development` ≠ custom `dev`. Adding a var to one does not update the
  other, and adding a var never updates a live deployment until a new
  `dev` deploy from current `develop`.
