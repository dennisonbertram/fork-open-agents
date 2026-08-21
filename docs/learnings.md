# Learnings (repo-wide)

Short cross-cutting notes. Detailed entries live in
[`docs/agents/lessons-learned.md`](agents/lessons-learned.md).

## 2026-08-20 — Cloud UX walk unblock

- Test-auth Sign out is a no-op unless the HttpOnly cookie is deleted
  (`Path=/`) in the server action before `redirect("/")`.
- `VERCEL_ENV=production` is the only safe Production signal for
  refusing test-auth. `NODE_ENV=production` is true on every Vercel
  deploy, including Preview/Dev.
- Browser tools have no cookie API. Playwright will honor `Set-Cookie`
  from `GET /api/dev/test-auth` (and `?next=/sessions`). The older
  `/api/dev/managed-runtime-demo` setter also provisions a sandbox —
  do not use it just to authenticate a walk.
- A seeded GitHub account with a fake token trips undismissable
  `GitHubReconnectGate`. Prefer a null token plus a connection-status
  exception for `dev-managed-runtime-user` while test-auth is on.
- After #1390, local `GET /api/dev/test-auth?next=/sessions` walks
  STORY-158 in 2 steps. A Preview JSON 404 means the route is live and
  the flag is off; a Dev HTML 404 means the merge has not deployed yet.
  This VM cannot flip Vercel env vars (`vercel` logged out).
- Vercel `development` is not the custom `dev` environment. `vercel env
  add … development` arms local `vercel dev` only. The stable Dev URL
  needs `vercel env add … dev` and a new `vercel deploy --target=dev`
  from current `develop`. Redeploying the old `dpl_4j7yWJe…` URL would
  keep the missing route.
- Custom `dev` can be branch-matched to `develop` and still be stale.
  `vercel target list` showed `dev` Updated **80d** after #1390 merged.
  Do not treat a develop merge as a Dev deploy.
