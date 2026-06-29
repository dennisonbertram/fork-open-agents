# Standalone Background Agent Review

**Date:** 2026-06-28
**Method:** Adversarial multi-agent workflow — 6 parallel reviewers (connectors, cron scheduler, runtime e2e, security, background-agents vs agent-loops overlap, Composio), each finding challenged by 2 adversarial skeptics that tried to refute it, then synthesized. 85 agents, ~4.6M tokens, 1,341 tool calls. **39 findings → 19 confirmed, 17 uncertain, 3 refuted.** Every load-bearing claim was independently verified by reading the cited file:line. Labels: **PROVEN** (read the code), **UNKNOWN** (cannot verify from this checkout).

**Scope:** (a) is the standalone background agent actually working today, (b) connector coverage — cron and Slack/external triggering, (c) what to lean into next.

---

## 1. Is it actually working today?

**Short answer: the wiring is real and internally consistent, but there is no in-repo evidence a real run completes end-to-end. "Working" is PROVEN at the contract/wiring level and UNPROVEN at the execution level.**

### What is PROVEN to work (wiring)

- **GitHub App triggers are wired.** Four event kinds dispatch via `dispatchBackgroundTriggerEvent` (`types.ts:4-11`): `github.pull_request`, `github.pull_request_review`, `github.deployment_status`, `github.issue`. The webhook route normalizes and dispatches.
- **Cron dispatch fires for built-in presets.** `vercel.json:4-7` polls `/api/background-agents/cron` every 5 minutes. `dispatcher.ts:500` uses `now = new Date()` and `scheduleMatchesNow` (`schedule.ts:40-76`) does an exact-minute match. All built-in presets use minute 0 (`schedule-presets.ts:16-22`), which aligns to the 5-minute grid, so `@hourly`, `0 9 * * *`, `0 9 * * 1-5`, and `@weekly` fire correctly under normal conditions.
- **The CRON_SECRET fallback is intentional Vercel platform integration, not a fragile hack.** `BACKGROUND_AGENTS_CRON_SECRET` is absent in `.env.local` but `CRON_SECRET` is set. Vercel Cron auto-injects `CRON_SECRET` as `Authorization: Bearer <secret>` on every tick; the route's `isAuthorized()` matches it. The readiness system accepts either secret (`readiness.ts:132-137`), a unit test confirms `CRON_SECRET` alone yields `ready`, and an env-audit script checks the live Vercel project. **This was adversarially checked and is fine** (see section 4).
- **Composio outbound tools are wired end-to-end for `ready_pr` agents (Phase 5).** `executor.ts:964-975` calls `resolveComposioToolsForBgRun` when `composioToolkitSlugs` is non-empty; on `status:"ready"` the tools are injected into `runMutationAgent` (`executor.ts:1031-1056` → `openAgent.generate` at `:332-335`). `COMPOSIO_API_KEY` is set in `.env.local`. This directly contradicts the epic's "Composio deferred to v1.5" (`background-agents-epic.md:19-20,86`) — that doc is stale.
- **Manual test trigger works** (`dispatchManualBackgroundAgentTest`).
- **Idempotency dedup is correct.** `getScheduleExternalId` (`dispatcher.ts:480-483`) buckets by `triggerId:ISO-minute`, and `createRunForTrigger` uses `onConflictDoNothing` on the idempotency key. Same-minute replays dedupe; adjacent windows don't falsely merge.
- **HMAC webhook signature verification is implemented** (`signature.ts:1-23`: `createHmac` + `timingSafeEqual`).
- **Payload redaction is enforced in code**, not just docs: `redactBackgroundAgentPayload` is applied at both DB-write boundaries (`store.ts:449,475`). (Caveat: pattern-based with gaps — see section 3.)

### What is NOT proven / NOT working

- **No in-repo evidence a real run completes end-to-end.** `executor.test.ts` mocks every external dependency — `connectSandbox` → `fakeSandbox` (`:135`), `openPullRequest` → fixed PR (`:184-188`), `openAgent.generate` → canned stop result (`:194-211`), store fully mocked (`:216`). CI (`.github/workflows`) has zero background-agent references; contract tests (`apps/web/tests/contract/`) cover only auth/client/git-routes/reads/skills-crud — no background-agent coverage; `preview-smoke.ts` hits only `/`, `/api/auth/info`, `/api/models`. The only e2e path is the **manual operator runbook** (`docs/process/background-agents-live-proof.md:1-9`), which explicitly defers Composio/Slack (`:22`) and has no recorded completed run in-repo (the "Live proof completed for #26" string is an unfilled template at `:358`). **PROVEN: green CI does not prove a real run completes. UNKNOWN: whether a run has ever completed in a deployed environment — that cannot be verified from this checkout.**

- **Cron scheduler has real correctness gaps** (PROVEN):
  - **5-minute alignment footgun.** The route is only invoked at minutes 0,5,10,…,55. A custom cron like `17 9 * * *` is never evaluated at minute 17, so it silently never fires. `validateSchedule` (`schedule-presets.ts:35-97`) checks grammar only — no grid-alignment guard — and the UI exposes a free minute picker (`schedule-builder.ts:15-47` produces `${minute} * * * *` for any 0-59). The `SchedulePreview` calls `computeNextRuns`, which scans minute-by-minute and will display "9:17 AM" as the next run for a schedule that can never fire — actively misleading.
  - **No missed-tick catch-up.** `dispatcher.ts:535` evaluates `scheduleMatchesNow` against the current poll minute only. `nextRunAt`/`lastRunAt` are written by `advanceTriggerScheduleState` (`store.ts:733-747`) but are never read back to fire missed windows. If the 09:00 poll is dropped (Vercel cold start, deploy, transient 5xx), the 09:05 poll checks minute 5 ≠ 0 and the daily run is silently lost until tomorrow.
  - **No retry for failed runs.** BT-006 (`dispatcher.ts:608-615`) advances the schedule unconditionally before the created-check. A transient workflow-start failure marks the run terminal (`dispatcher.ts:60-79`) with no re-queue. A failed `0 9 * * *` run is gone until tomorrow 09:00.
  - **No sweeper for stuck `running` background-agent runs.** Only `sweepStalledLoopRuns` exists (`lib/agent-loops/sweep.ts:55`), and it is loop-scoped. There is no `sweepStalledBackground*` equivalent anywhere (grep confirmed). No outer try/catch wraps the executor body (`executor.ts:776-1257`); an uncaught throw (e.g. `verifyRepoAccess` at `:821`) or a workflow-runtime death leaves the `backgroundAgentRuns` row stuck at `running` indefinitely.

- **Composio silently degrades** (PROVEN):
  - Resolution failure (`status:"error"`) records only a warn-level event and continues (`executor.ts:992-1010`, comment `:1009` "Non-fatal: run continues without Composio tools"). No `errorKind` is set, so the run reaches `succeeded` with a `ready_pr` that doesn't reflect the agent's intended tool behavior.
  - The `disconnectedToolkits` warning that the chat path surfaces is **dropped** by the background wrapper (`composio-tools.ts:255-263` returns only `{status, tools, toolkitSlugs}`). A background agent with a Slack toolkit that has no connected account gets dead tools + a success event.
  - The `off` case (repo policy blocks all slugs, `composio-tools.ts:218-220`) emits **no event at all** (`executor.ts:974-1011` has only `ready` and `error` branches).

- **Only `ready_pr` runs an agent loop.** `runMutationAgent` is called only inside `if (agent.outputMode === "ready_pr")` (`executor.ts:1014,1031`). For `comment`/`issue`/`notification`/`none` modes, Composio tools are resolved (emitting a `composio.resolved` event) but never used — no LLM work happens. All Composio tests default to `ready_pr`, so this gap is untested.

- **`ready_pr` can orphan a branch.** The commit lands via the App installation token (`executor.ts:507-527`), then the PR is opened via a separate user token (`:549-576`). If the user token is missing/expired, the throw at `:551` fires after the commit succeeds; the catch (`:1190-1217`) records `pr_creation_failed` but performs no branch cleanup. The branch is discoverable via the `commit.completed` event but is not auto-removed.

- **Usage has no run attribution.** `usage_events` (`schema.ts:2474-2499`) has columns `userId, source, agentType, provider, modelId, tokens, createdAt` — no `runId`/`agentId`/`triggerId`. The executor calls `recordUsage` at `executor.ts:369-379` with `runId` in scope but not passed. **Agent-loops records NO usage at all** — grep for `recordUsage` in `apps/web/lib/agent-loops/` returned zero hits. This confirms the prior memory note and is worse: loop token cost is entirely invisible to `usage_events`.

- **Agent-loops stall sweep is built but unscheduled.** `/api/agent-loops/sweep` is fully implemented but `vercel.json` has only the background-agents cron — no sweep entry. A wedged loop run is never auto-recovered in production. This is half-finished M1-10 work; the epic itself (`agent-loops-epic.md`) relies on the sweep as a safety net.

- **Background agents can't self-propose tools.** `propose_composio_tool` is gated by `toolAuthoringEnabled` + a `proposeToolAction` closure (both wired in chat, neither wired in the background executor at `executor.ts:292-308`). An autonomous agent that discovers mid-run it needs Slack has no way to request it; its toolset is owner-pinned at config time.

---

## 2. Connector coverage — cron and Slack/external triggering

### Cron: works for presets, broken for custom cron, no resilience

**PROVEN:** The cron connector is the single scheduled entry point. It works reliably for the four built-in presets (all minute-0, grid-aligned). It is **broken for non-5-aligned custom cron** (silently never fires; preview shows unreachable runs), has **no catch-up** for missed polls, **no retry** for failed runs, and **no sweeper** for stuck runs. The idempotency layer is sound (per-minute bucketing prevents double-fire) — the data-loss risk is missed polls and failed runs, not dedup.

### Slack / external triggering: Slack CANNOT trigger an agent

**PROVEN:** There is no Slack trigger ingestion path. The string "slack" appears in the background-agents code only in test files as a Composio toolkit slug example. The trigger-kind enum is closed at exactly six members (`types.ts:4-11`) — no `slack.*`, no `external.*`. Run sources are `github`/`schedule`/`webhook` only (`types.ts:16-20`).

The **only** external (non-GitHub, non-cron) trigger surface is the `webhook.error` route (`app/api/background-agents/webhook/[publicId]/route.ts`):
- Schema is `.strict()` (`:18`) with a fixed field set — `externalId` required, optional `repoOwner/repoName/severity/title/message/url/actor/occurredAt`. Extra fields cause a 400. Slack's native payload would be rejected unless a translation layer reshapes and re-signs it.
- The dispatcher hardcodes `source:"webhook"` and `kind:"webhook.error"` — the caller cannot supply a different kind or arbitrary passthrough payload.
- Signature is HMAC-SHA256 only (`signature.ts:1-23`) — **no timestamp, no nonce, no replay window, no rate limit**. `occurredAt` is optional and is never freshness-checked (and is not even persisted to the run row). Pure replay without the secret is neutralized by `externalId` idempotency, but a captured payload never expires, and a leaked secret means unlimited minted runs.

**Slack as an outbound TOOL works** (for `ready_pr` only): `resolveComposioToolsForBgRun` resolves any slug including `slack` via connected accounts, and the tools are injected into the agent loop. But there is **no outbound content gate** — no egress filtering, destination allowlist, size cap, or secret-scan on Composio messaging tool calls. A prompt-injected GitHub trigger (PR/issue body) could exfiltrate repo contents to a Slack channel.

**Composio is outbound-only.** There is no inbound event listener anywhere in `lib/composio`. Composio gives the agent outbound capabilities during a run; it provides no inbound triggering. Do not attempt inbound Slack triggering through Composio.

---

## 3. Security posture (verified)

- **Redaction is enforced but pattern-based.** `redactBackgroundAgentPayload` runs at both DB-write boundaries (`store.ts:449,475`). Gaps: regex-pattern-based (a secret under a non-conforming key name persists; the payload layer lacks the `sk-` pattern the browser layer has), outbound Composio content is not filtered, and event `summary`/`payloadSummary` are stored raw (`store.ts:444`). Treat as defense-in-depth, not a guarantee.
- **publicId is an identifier, not a credential** — `nanoid(16)` (~95 bits). The HMAC secret is the trust boundary. This is correct design.
- **Allowlist asymmetry for loops is intentional** — the external webhook path double-gates loop-bound triggers (both allowlists), the internal cron path single-gates (loops allowlist only). Defensible, but `AGENT_LOOPS_ALLOWED_REPOS` is **empty** (allow-all) in `.env.local`, so loop-bound schedule triggers fire on any repo with an active loop.

---

## 4. What we checked that turned out fine (adversarial pass)

Three findings were investigated and **refuted** — included so the adversarial pass is visible:

1. **"Cron route may silently 401 in production because vercel.json has no authorization wiring"** — REFUTED. Vercel Cron auto-sends `CRON_SECRET` as `Authorization: Bearer <secret>` by platform contract; `.env.example` documents this; the readiness check and env-audit script both accept `CRON_SECRET`; `CRON_SECRET` is set in `.env.local` and (per the audit) in production env. No separate production config is needed.
2. **"'Daily (morning)' preset misleads local users with 09:00 UTC"** — REFUTED. The "morning" label lives only in an unused constant (`SCHEDULE_PRESETS`); the actual picker UI shows "Daily" + an explicit "Time of day (UTC)" selector, and the preview renders next runs in the user's **local** timezone via `Intl.DateTimeFormat`. No user sees a misleading "morning" label.
3. **"Cron route accepts side-effecting GET (CSRF/prefetch risk)"** — REFUTED as a security concern. Vercel Cron uses GET by platform mandate; the bearer header (not a cookie) makes CSRF inapplicable; an unauthorized GET hits the 401 path and dispatches nothing. Only a cosmetic REST-hygiene nit remains (and dropping GET would break production cron).

---

## 5. What to lean into next (ordered by priority)

1. **Prove it works before leaning in.** Execute the live-proof runbook against a preview deployment; capture a real run ID + ready-PR URL into the epic issue. Then convert the manual runbook into a CI-gated smoke that drives `dispatchManualBackgroundAgentTest` against a preview env with a disposable repo and asserts a terminal run status within a timeout.
2. **Make the cron scheduler reliable.** Switch `vercel.json` to `* * * * *` (every minute) so every cron minute is reachable — the cheapest correct fix that makes `scheduleMatchesNow`'s single-point check trustworthy for arbitrary expressions. Add catch-up using `nextRunAt`/`lastRunAt` (if `now >= nextRunAt`, dispatch and recompute, keyed by per-window idempotency). Add a background-agent run sweeper mirroring `sweepStalledLoopRuns`, wired to a cron. Add bounded retry for transient failures, distinct from the BT-006 advance.
3. **Harden + generalize the external webhook — the single move that unlocks Slack.** Add a mandatory timestamp + max-skew window + per-publicId rate limit to `signature.ts`. Add a generic `external.webhook` trigger kind that reuses the `publicId` + URL + copy-UI, drops the rigid `.strict()` error schema for a passthrough payload, and supports per-provider signing. Ship one provider adapter (Slack Events API, which signs with a timestamp — reuse it for the freshness the current path lacks) as proof. This unlocks Slack/Sentry/Linear/incident.io through one generic surface.
4. **Surface Composio degradation and extend agent loops to non-`ready_pr` modes.** Propagate `disconnectedToolkits`, emit a `composio.skipped` event for `off`, add a `composio_resolution_failed` errorKind or degraded-mode banner so "succeeded" doesn't mask "ran without tools." Give `comment`/`issue`/`notification` modes an agent loop (or document them as report-only) — most high-value external-tool use cases (notify Slack, file an issue, comment on a PR) live in modes that currently do nothing.
5. **Add usage run attribution.** Add a nullable `runId`/`agentId`/`triggerId` to `usage_events` (or a join table) and have both executors record it. This is the prerequisite for per-agent cost dashboards and for trusting the economics before production volume.
6. **Decide on agent-loops: close the gaps or consolidate.** Either commit to it as a parallel product and immediately schedule the sweep + add usage recording + unify the allowlist gate, or pursue the unification option (one Workflows surface, bg agent = 1-node workflow). Don't leave both half-finished — the shared trigger table means divergence there is the actual risk.
7. **Add outbound egress controls on Composio messaging tools** (destination allowlist, size cap, secret-scan) before leaning into external-tool runs that handle repo data. Treat GitHub-triggered instruction channels (PR/issue bodies) as untrusted prompt-injection input.
8. **Wire `propose_composio_tool` into background runs** for self-improving autonomy (owner approval already gates activation).

---

## Bottom line

The standalone background agent is a real, coherently-wired system — GitHub/cron/signed-webhook/manual triggers, Composio outbound tools, idempotent dispatch, enforced redaction. The planning docs understate it (Composio is live, not deferred). But you cannot today prove a run completes end-to-end from in-repo evidence, the cron scheduler silently loses runs under realistic failure modes (missed polls, non-aligned custom cron, no retry, no sweeper), and Slack — the connector asked about — has no trigger path at all. The highest-leverage moves are: prove it, make the scheduler resilient, and build one hardened generic external-trigger surface that Slack can actually drive.
