# Development log — STORY-158 after #1390 (2026-08-20)

## Done

- Merged #1390 into `develop` (`f1f918b4`).
- Probed Preview / Dev / Production for `GET /api/dev/test-auth`.
- Walked STORY-158 locally via the new bootstrap (2/2). Screenshots in
  `docs/ux-paths/browser/walk-story-158/`.

## Incorrect assumptions

1. Assumed merge to `develop` would immediately update the Dev URL — it
   still served HTML 404 (`x-matched-path: /404`) on the previous deploy id.
2. Assumed this VM could set the Dev env var — no Vercel token, CLI logged
   out. Slice 5 stays operator-owned.
3. Assumed Preview would already have the stale test-auth flag — Preview
   has the new route and returns JSON 404 (flag off).

## Global learnings

- Preview JSON 404 vs Dev HTML 404 is the difference between “route
  deployed, flag off” and “old build, route missing”.
- Local `GET /api/dev/test-auth?next=/sessions` is enough to walk
  authenticated catalog stories without mocking connection-status.
