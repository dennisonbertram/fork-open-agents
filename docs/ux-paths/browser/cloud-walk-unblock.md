# Cloud UX walk unblock — implementation notes (2026-08-20)

Implements epic [#1389](https://github.com/dennisonbertram/fork-open-agents/issues/1389)
slices 1–4. Plan: [docs/plans/cloud-ux-walk.md](../../plans/cloud-ux-walk.md).

## User-visible changes

- **Sign out works under test-auth.** The server action now expires
  `open_agents_test_user_id` (`Path=/`) before redirecting to `/`, so the
  marketing page no longer bounces a “signed out” demo user back to
  `/sessions` (#1386).
- **New cookie-only bootstrap.** `GET /api/dev/test-auth` (404 unless
  test-auth is enabled) sets the demo cookie and seeds the demo user + a
  GitHub account row + an installation. It does **not** provision a sandbox.
  `?next=/sessions` redirects after the cookie is set. Absolute and
  protocol-relative `next` values are ignored.
- **Demo user is not bricked by Reconnect GitHub.** While test-auth is
  enabled, `/api/github/connection-status` reports `connected` for
  `dev-managed-runtime-user` so `GitHubReconnectGate` stays closed.

## Safety

`isTestAuthEnabled()` now returns false whenever `VERCEL_ENV === "production"`,
even if `OPEN_AGENTS_ENABLE_TEST_AUTH=1`. That is fail-closed on a security
boundary. Unset `VERCEL_ENV` still allows local/CI (fail-open for the
platform signal, because local machines are not Production).

Do not enable the flag on Production. Slice 5 is an operator action on the
stable Dev deployment only.

## Remaining

Slices 5–6 are not done: no Vercel CLI in this environment, and no
authenticated cloud walk was attempted or faked.

## Incorrect assumptions corrected while implementing

1. **Turbo must allowlist `NODE_ENV`.** Wrong. `NODE_ENV` is a runtime
   builtin. Only `VERCEL_ENV` and `OPEN_AGENTS_ENABLE_TEST_AUTH` need to
   appear together on the build task.
2. **A seeded fake GitHub token is useful.** Wrong. A placeholder token
   still gets sent to GitHub by other callers. The seed stores `accessToken:
   null` and the connection-status short-circuit is what keeps the gate
   closed.
3. **`cookies()` + `redirect()` cannot clear a cookie.** The Next.js
   lesson is about `cookies()` + `Response.redirect()` in *route
   handlers*. Server actions can `cookies().delete({ name, path: "/" })`
   before `redirect("/")`.
