# Cloud UX Walk — Unblock Plan

Status: **slices 1–4 merged in [#1390](https://github.com/dennisonbertram/fork-open-agents/pull/1390) (`f1f918b4`).** Local STORY-158 walked 2/2. Slice 5 is still blocked: the 2026-08-20 operator add targeted Vercel `development`, not the custom `dev` environment, and the Dev URL is still the pre-merge deploy.
Epic: [#1389](https://github.com/dennisonbertram/fork-open-agents/issues/1389).
Related: [Browser catalog](../ux-paths/browser/catalog.md), [Dogfood The Cloud Loop](../process/dogfood-cloud-fanout.md).

A cloud session can already drive Playwright (`packages/agent/tools/browser.ts`)
unattended. It still cannot walk an authenticated catalog story until a
deployed target honors test-auth safely. This plan is the ordered unblock.

## What shipped here (slices 1–4)

| # | Slice | Status | What landed |
|---|-------|--------|-------------|
| 1 | Sign out clears the test-auth cookie ([#1386](https://github.com/dennisonbertram/fork-open-agents/issues/1386)) | Done | `signOut` calls `deleteTestAuthCookie` so `/` cannot immediately re-authenticate |
| 2 | Production hard-guard | Done | `isTestAuthEnabled()` returns false when `VERCEL_ENV === "production"`, even if `OPEN_AGENTS_ENABLE_TEST_AUTH=1`. Proven through `resolveSessionFromHeaders` and `checkBotProtection`. `OPEN_AGENTS_ENABLE_TEST_AUTH` added to Turbo's build env allowlist with `VERCEL_ENV`. `.env.example` documents the refusal |
| 3 | Cookie-only bootstrap `GET /api/dev/test-auth` | Done | 404 when disabled; seeds user + GitHub account (null token) + installation; sets the cookie; optional safe `?next=/sessions` redirect. No sandbox import |
| 4 | Reconnect gate must not brick the test user | Done | `/api/github/connection-status` returns `connected` for `TEST_AUTH_USER_ID` while test-auth is enabled. Real users unchanged. Dialog dismissibility (STORY-024) is still a separate real-user fix |

## Still blocked (not faked)

| # | Slice | Owner | Why it is still blocked |
|---|-------|-------|-------------------------|
| 5 | Enable `OPEN_AGENTS_ENABLE_TEST_AUTH=1` on the custom **`dev`** environment only; delete any stale Preview branch var | Operator | Flag is on `dev` (`vercel env ls`: Encrypted, `dev` only, 7m ago). Live URL still HTML 404 on `dpl_4j7yWJe…` — needs `vercel deploy --target=dev` from current `develop`. Branch tracking is stale (Updated 80d). See [STORY-158 walk](../ux-paths/browser/walk-story-158.md) |
| 6 | Prove STORY-158 from an unattended `open_agents_start_session` | After slice 5 | Local walk done (2/2). Cloud/Dev walk not faked |

## How a cloud walker should authenticate after slice 5

1. `browser_navigate` → `https://<dev>/api/dev/test-auth?next=/sessions`
2. Playwright honors `Set-Cookie` on the redirect
3. `/sessions` should render without `GitHubReconnectGate`
4. Walk one catalog story and screenshot each step

Local equivalent (already works when `NODE_ENV=development`):

```bash
curl -sS -D - http://localhost:3000/api/dev/test-auth -o /dev/null
```

## Guard notes (slice 2)

- Fail **closed** on `VERCEL_ENV === "production"` (security boundary).
- Fail **open** when `VERCEL_ENV` is unset (local/CI must keep working).
- `NODE_ENV` is a runtime builtin and is not Turbo-allowlisted.
- Presence of `OPEN_AGENTS_ENABLE_TEST_AUTH` in `.env.example` is
  documentation, not arming — the template leaves it commented/empty.
