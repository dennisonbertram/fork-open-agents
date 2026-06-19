# API Contract Tests

Real-HTTP contract tests for the app's API. Unlike the colocated `route.test.ts`
unit tests (which mock auth, DB, sandbox, etc.), these hit a **running server**
over HTTP with the dev test-auth cookie and assert the actual contract: status
codes, response shapes, and auth/ownership gating. They let us verify the
backend independently of the UI, so frontend tests can trust the API boundary.

Location: `apps/web/tests/contract/`. Runner: `bun run test:contract`.

## What they cover

- **Auth gating** (`auth.test.ts`) — every protected endpoint returns `401`
  without the cookie (proves the route is deployed and gated).
- **Read contracts** (`reads.test.ts`) — `GET` of `models`, `settings/preferences`,
  `settings/skills`, `inference-profiles`, `sessions`, `workflows/catalog`,
  `usage` returns `200` with the documented top-level shape.
- **Skills CRUD** (`skills-crud.test.ts`) — full create → list → update → delete
  round-trip for the test user, plus `409` (duplicate name) and `400` (reserved
  name). Self-cleaning, so it is safe to re-run.
- **Git/GitHub routes** (`git-routes.test.ts`) — `401` (no auth), `404`
  (unknown session), `400` (invalid body), and `200`/`409` (sandbox state) for
  `git/status`, `git/branch`, `git/pr`. No real git mutations (a sandbox-less
  session 409s first), so it is safe anywhere.

## How to run

The target-bound suites only run when `CONTRACT_BASE_URL` is set; otherwise
they **skip** (so `bun run ci` stays green — the isolated runner discovers them
but they no-op without a target). Pure client policy tests still run without a
target.

Against a local dev server:

```bash
# terminal 1 — dev server with test-auth enabled
PORT=3013 OPEN_AGENTS_ENABLE_TEST_AUTH=1 bun run web

# terminal 2 — point the suite at it
CONTRACT_BASE_URL=http://localhost:3013 bun run test:contract
```

Against a protected preview deployment (test-auth must be enabled there, see
`docs/plans/release-safety-pipeline.md`):

```bash
CONTRACT_BASE_URL=https://<preview-host> \
  VERCEL_AUTOMATION_BYPASS_SECRET=<secret> bun run test:contract
```

Auth uses the `open_agents_test_user_id` cookie for `dev-managed-runtime-user`
(see `apps/web/lib/session/test-auth.ts`); the client lives in
`apps/web/tests/contract/_client.ts`. The client sends the Vercel automation
bypass header when `VERCEL_AUTOMATION_BYPASS_SECRET` is set, and retries only
`GET` requests on a transient 5xx (a freshly-forked preview Neon branch can blip
on its first connection).

## CI

`.github/workflows/contract-tests.yml` runs this suite on every successful
**non-production** preview deployment (`deployment_status` trigger), pointing
`CONTRACT_BASE_URL` at the preview URL with the bypass secret — mirroring the
`preview-smoke` job. It is a **separate, non-required** workflow: it surfaces
backend-contract signal on PRs without gating merges. Promote it to a required
check once it has proven stable.

Resilience: the suite probes auth once at startup. If the target lacks
`OPEN_AGENTS_ENABLE_TEST_AUTH` (or the dev user), the authenticated suites
**skip** and only the unauthenticated auth-gating checks run, so the job stays
green instead of failing.

## Extending

Add a `*.test.ts` under `apps/web/tests/contract/` and use `apiFetch` /
`apiJson` from `_client.ts`. Wrap auth-gating (no-cookie) suites in
`describe.skipIf(!contractEnabled)`; wrap authenticated suites in
`describe.skipIf(!(contractEnabled && authAvailable))` so they skip when the
target has no test-auth. Keep mutations safe (idempotent or self-cleaning) and avoid
endpoints that require external services (harness/SSE), OAuth callbacks, or
real git pushes — those need a mock/service and are out of scope for the
black-box suite.

## Not yet covered

Server-action-only surfaces (`unlinkGitHub`, admin token revocation, the UI
`signOut` action), harness/verified-build proxy + SSE endpoints, chat
streaming, and OAuth callbacks. See the API-coverage notes for the full list.
