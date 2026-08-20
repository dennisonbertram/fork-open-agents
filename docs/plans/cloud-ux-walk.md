# Cloud UX Walk — Feasibility (2026-08-20)

Status: **stopped before building a harness; unblock plan filed as epic [#1389](https://github.com/dennisonbertram/fork-open-agents/issues/1389).** Neither authenticated target route works today without significant new infrastructure. Prompt 1's local walk proved the catalog walk is worth automating; this doc records what a cloud session would need before a single story can be proven end-to-end, and the ordered plan to get there.

Related: [Dogfood The Cloud Loop](../process/dogfood-cloud-fanout.md), [Browser walk 2026-08-20](../ux-paths/browser/walk-2026-08-20.md).

## What was verified (matches the prompt's claims)

| Claim | Verified |
|-------|----------|
| `packages/agent/tools/browser.ts` — navigate / click / type / extract / screenshot | Yes |
| Screenshots stream inline as PNG via `writer.write({ type: "file", ... })` | Yes (code path present) |
| `browser-session.ts` lazily imports Playwright Chromium | Yes |
| Browser tools auto-approve when `getUnattended(context)` is true | Yes (`needsApproval: (...) => !getUnattended(...)`) |
| `sandbox_browser_runs` table records browser actions | Yes (`schema.ts` ~514) |

No contradiction found with the prompt's "what already exists" list. Gaps are in **target reachability and auth**, not in the tool surface itself.

## The question

Can a session started via `open_agents_start_session` reach a running Open Agents UI, sign in, and walk one authenticated catalog story with screenshots?

### Route A — sandbox runs the app (`bun run web`)

**Does not work today.**

Missing:

1. **App + deps in the sandbox.** A typical cloud session sandboxes the *user's* repo. Even when the repo is this fork, the sandbox image is not the Cursor cloud VM: it does not automatically have a migrated Postgres, `apps/web/.env.local`, or Vercel OAuth secrets.
2. **Database.** The web app requires `POSTGRES_URL`. Sandboxes do not ship with Neon credentials or a local Postgres. Injecting Production `POSTGRES_URL` is forbidden; injecting Preview/dev would need a deliberate secret-plumbing design.
3. **Auth.** Local test-auth works only when `NODE_ENV=development` or `OPEN_AGENTS_ENABLE_TEST_AUTH=1`. A sandbox-hosted Next server could use those flags, but still needs the DB rows / connection-status behavior from Prompt 1.
4. **Chromium for Playwright.** `playwright` is an agent dependency, but Chromium binaries are not guaranteed in the Vercel Sandbox base image. Managed-runtime profiles sometimes install browsers as an optional step; classic sandboxes may need `playwright install chromium` every cold start (~minutes) unless a base snapshot bakes them in.
5. **Loopback browse.** Even if the app listened on a sandbox port, the agent browser tools would need a reachable URL (sandbox port forwarding / service URL). That wiring exists for *preview services of the user's app*, not for "Open Agents hosting itself."

### Route B — browse a deployed URL

**Does not work today without new env + auth bootstrap.**

Missing:

1. **Test-auth on a non-Production environment.** `OPEN_AGENTS_ENABLE_TEST_AUTH` is currently described as set only on a stale Preview branch (`codex/background-agents-foundation`). It must **never** be set on Production. Enabling it deliberately on Preview or the stable Dev deployment is a product/ops decision, not something a cloud session can invent.
2. **Cookie bootstrap via browser tools.** The five browser tools have **no cookie API**. Playwright will honor `Set-Cookie` on navigation responses, but the only existing helper that sets `open_agents_test_user_id` is `/api/dev/managed-runtime-demo`, which also tries to provision a real sandbox and only sets the cookie on the success path. There is no "set test-auth cookie only" endpoint.
3. **GitHub connection-status.** Prompt 1 showed that a seeded GitHub account with a dead token trips `GitHubReconnectGate` and blocks the whole UI. A cloud walker needs either a real token, a connection-status mock (impossible against a shared Preview), or a product change to soften the gate for the test user.
4. **Inference / sandbox credentials** for chat-loop and sandbox-lifecycle stories — same as Prompt 1's unwalked set.

### What a headless cloud session *can* do today

- Navigate to **public** URLs (marketing `/`, `/deploy-your-own`, dead `/shared/...` 404) and screenshot them.
- That covers only a thin slice of the catalog and **cannot** satisfy "shortest authenticated story."

## Honest stop condition

> Neither route works without significant new infrastructure. A clear "here is what it would take" is a better result than a half-built harness. Do not fake a walk.

**No end-to-end authenticated cloud walk was attempted or faked.**

## What it would take (ordered)

### Minimum for ONE authenticated story (e.g. STORY-158 / New Session dialog)

1. **Ops:** Enable `OPEN_AGENTS_ENABLE_TEST_AUTH=1` on the stable **Dev** (or a dedicated Preview) deployment — never Production. Document the env and the blast radius (#1386 already shows Sign out is broken under test-auth).
2. **Product:** Add a narrow bootstrap route, e.g. `GET /api/dev/test-auth` (test-auth gated), that only sets the test-auth cookie and returns `{ ok: true }` — no sandbox provisioning.
3. **Data:** Ensure `dev-managed-runtime-user` exists on that env's Neon branch with GitHub account + installation rows **and** either a working GitHub token or a connection-status exception for the test user (otherwise reconnect gate blocks).
4. **Agent prompt:** `open_agents_start_session` unattended run that:
   - `browser_navigate` → bootstrap URL
   - `browser_navigate` → `/sessions`
   - click New session → Start session
   - screenshot each step
   - report actual vs ideal (2)
5. **Proof:** Chat transcript with inline PNGs + step counts checked against the catalog.

### To run the other ~186

- Story runner that reads catalog Ideal path / Preconditions.
- Skip / record unwalked when flags off (`AGENT_LOOPS_ENABLED`, etc.).
- Dedicated disposable GitHub App install + allowlisted repo for repo-backed stories.
- Inference credentials for chat-loop failure/stop stories.
- Optional: bake Playwright Chromium into `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` so browser tools cold-start reliably.
- Optional Route A later: "dogfood the dogfood" profile that boots the web app against a dedicated Neon branch inside the sandbox — much larger than Route B.

## Assumptions that could not be verified in this cloud agent VM

- Whether the production/dev Vercel Sandbox base snapshot already contains Chromium.
- Whether Preview currently still has `OPEN_AGENTS_ENABLE_TEST_AUTH` (prompt says only the stale branch; this agent had no Vercel CLI login to confirm).
- Whether `open_agents_start_session` MCP from *this* Cursor cloud agent can reach the user's Open Agents deployment (MCP server for Open Agents was not available in this run's tool catalog).
- Live behavior of browser tools against an external HTTPS origin from inside a real Vercel Sandbox (unit tests mock Playwright).

## Unblock plan (epic #1389)

Durable record: [#1389](https://github.com/dennisonbertram/fork-open-agents/issues/1389). Six ordered PR-sized slices, safety first — each with its acceptance condition written before dispatch, per [Dogfood The Cloud Loop](../process/dogfood-cloud-fanout.md).

| # | Slice | Blocker it removes | Key files | Gate |
|---|-------|--------------------|-----------|------|
| 1 | Sign out clears the test-auth cookie ([#1386](https://github.com/dennisonbertram/fork-open-agents/issues/1386)) | Sign out is a no-op under test-auth — unsafe to enable anywhere shared | `lib/auth/actions.ts`, `lib/session/test-auth.ts` | Red test first: sign-out response lacks clearing `Set-Cookie` |
| 2 | Guard: `isTestAuthEnabled()` hard-refuses when `VERCEL_ENV === "production"` | "Never on Production" is currently a rule, not a guard — `test-auth.ts` has no production check at all | `lib/session/test-auth.ts`, Turbo env allowlist, `.env.example` | [Guard Integrity](../process/guard-integrity.md): refusal proven through `resolve-session`, allow paths proven, mutation-check the guard |
| 3 | Cookie-only bootstrap route `GET /api/dev/test-auth` | Browser tools have no cookie API; only existing cookie-setter also provisions a sandbox | new `app/api/dev/test-auth/route.ts` + idempotent seed helper | 404 when disabled; cookie + seeded rows + zero sandbox imports when enabled. Works because Playwright honors `Set-Cookie` on `browser_navigate` |
| 4 | Reconnect gate must not brick the test user | Seeded fake token trips undismissable `GitHubReconnectGate` | (a) `connection-status` short-circuit for `TEST_AUTH_USER_ID` under test-auth, and/or (b) make the dialog dismissible (also fixes real-user STORY-024 trap) | `/sessions` renders for the test user without the blocking dialog |
| 5 | Ops: `OPEN_AGENTS_ENABLE_TEST_AUTH=1` on **Dev only**; delete the stale 83-day Preview branch var | No deployed authenticated target | Vercel env config (operator action — this agent VM has no Vercel auth) | Curl evidence: test cookie authenticates on Dev, refused on Production (slice 2 guard verified live first) |
| 6 | Prove ONE story (STORY-158) from an unattended cloud session | Nothing proven end-to-end | walk prompt via `open_agents_start_session` | Transcript with ≥4 inline PNGs, actual-vs-ideal 2 vs 2, `sandbox_browser_runs` rows |

Ordering rationale: slices 1–2 make test-auth safe to exist anywhere shared; 3–4 make a browser session able to authenticate and stay unblocked; 5 is the only shared-environment change and lands after the guard; 6 is the proof. Scale work (Chromium in the base snapshot, story-runner template, disposable repo, inference creds) stays behind slice 6 as follow-up tickets — see the epic.

## Recommendation

1. Ship Prompt 1's filed issues (#1384–#1387); they unblock real users without waiting on automation.
2. Execute epic [#1389](https://github.com/dennisonbertram/fork-open-agents/issues/1389) slices in order; stop after slice 6 and reassess before scaling to the full catalog.
3. Do not invest in Route A until Route B has walked a handful of authenticated stories successfully.
