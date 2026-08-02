# UX Paths — Agent loops and loop runs

Scope: `/api/agent-loops*`, `/api/agent-loop-runs/*`, plus the loop-shaped view in
`/api/account/diagnosis`. All routes verified by reading the route files under
`apps/web/app/api/agent-loops/**` and `apps/web/app/api/agent-loop-runs/**`.

Global facts that apply to every story below (from the code, not assumed):

- Every loop route except `GET /api/agent-loop-runs/[runId]` and
  `GET/POST /api/agent-loops/sweep` calls `requireAuthenticatedUser()` first and then
  `isAgentLoopsEnabled()`. Unauthenticated → the shared auth response (401).
  Authenticated but `AGENT_LOOPS_ENABLED` unset → **403 `{errorKind:"feature_disabled"}`**.
- `GET /api/agent-loop-runs/[runId]` has **no** feature-flag gate — it only does auth +
  ownership. That is an inconsistency worth noting: the run detail page keeps working
  when the flag is off, but every control button on it 403s.
- Ownership failures return **404**, never 403 (no existence leak).
- The sweep route is cron-secret only: `Authorization: Bearer <secret>` or
  `x-background-agents-cron-secret: <secret>`, secret =
  `BACKGROUND_AGENTS_CRON_SECRET` || `CRON_SECRET`.

Reusable minimal-valid definition used in several stories (matches
`loopDefinitionSchema` in `lib/agent-loops/types.ts` — nodes are a discriminated union
on `kind`, edges carry `when ∈ success|failure|true|false|always`):

```json
{
  "nodes": [
    { "id": "start", "kind": "start", "label": "Start", "position": { "x": 0, "y": 0 } },
    { "id": "triage", "kind": "agent_step", "label": "Triage flaky test",
      "position": { "x": 0, "y": 140 },
      "instructions": "Run the failing test in apps/web, find the root cause, and push a fix branch.",
      "checkCommand": "bun run --cwd apps/web test",
      "permissions": { "github": { "contents": "write", "pull_requests": "write" } },
      "builtinToolNames": ["read_file", "write_file", "bash"] },
    { "id": "ci", "kind": "github_check", "label": "CI status",
      "position": { "x": 0, "y": 280 },
      "check": { "kind": "ci_status", "refFrom": "triage.branch" } },
    { "id": "green", "kind": "condition", "label": "CI green?",
      "position": { "x": 0, "y": 420 },
      "condition": { "path": "ci.conclusion", "op": "eq", "value": "success" } },
    { "id": "done", "kind": "end", "label": "Done", "position": { "x": 0, "y": 560 } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "triage", "when": "always" },
    { "id": "e2", "source": "triage", "target": "ci", "when": "success" },
    { "id": "e3", "source": "ci", "target": "green", "when": "always" },
    { "id": "e4", "source": "green", "target": "done", "when": "true" },
    { "id": "e5", "source": "green", "target": "triage", "when": "false" }
  ]
}
```

---

## STORY-agent-loops-01: Check whether loops are usable for my repo before building one

**Type**: short
**Persona**: Maya, a platform engineer evaluating agent loops on a self-hosted deployment
**Goal**: Find out whether the loops feature is on and whether her repo is allowlisted, before wasting time in the builder
**Preconditions**: Authenticated session cookie; no loops exist yet
**Ideal path**: 1 call — readiness is designed as a single aggregate check and returns
both the flag and per-repo allowlist state when `owner`/`repo` are supplied.
**Alternate paths**: You can also infer the flag from *any* loop route's
403 `feature_disabled` body (e.g. `GET /api/agent-loops`), and infer repo allowlisting
by attempting `POST /api/agent-loops/[loopId]/runs` and reading `repo_not_allowed`
(403) / `repo_allowlist_unconfigured` (503). Readiness exists precisely so users
don't have to fail a run to learn this.

### Steps

1. `GET /api/agent-loops/readiness?owner=dennisonbertram&repo=open-agents` → expect 200
   `{enabled: true, checks: [{id:"feature_flag",status:"ready"},{id:"repo_allowlist",...},{id:"shared_webhook_allowlist",...},{id:"repo_access",...},{id:"shared_webhook_repo_access",...}]}`
   (the last two checks appear only because `owner` + `repo` were both passed).

### Variations

- Omit `owner`/`repo` → 200 with exactly 3 checks; no repo-scoped entries.
- Deployment with `AGENT_LOOPS_ALLOWED_REPOS` unset → `repo_allowlist.status:"missing"`,
  `missing:["AGENT_LOOPS_ALLOWED_REPOS"]`, and `repo_access.status:"missing"`.
- Repo not in the list → `repo_access.status:"disabled"`, detail
  `"…isn't enabled for loops on this deployment."`

### Edge Cases

- **Auth failure**: no cookie → 401 from `requireAuthenticatedUser`.
- **Feature disabled**: readiness is the one loop route that does *not* 403 when the
  flag is off — it returns 200 with `enabled:false` and
  `feature_flag.status:"disabled"`. Any other loop route in the same state returns 403.
- **Validation**: only `owner` supplied (no `repo`) → 200, repo-scoped checks silently
  omitted; no 400. Partial input fails quietly, which is easy to misread as "allowed".

---

## STORY-agent-loops-02: Draft a loop from a plain-English description

**Type**: short
**Persona**: Sam, a backend dev who wants automation but doesn't want to hand-author a graph
**Goal**: Turn "keep the nightly build green" into a starting loop definition
**Preconditions**: Authenticated; `AGENT_LOOPS_ENABLED=true`; AI Gateway reachable
**Ideal path**: 2 calls — draft, then create. The draft route deliberately does not
persist, so create is a separate call by design.
**Alternate paths**: Skip drafting entirely and `POST /api/agent-loops` with a
hand-written `definition` (STORY-03). Two independent ways to obtain a valid definition.

### Steps

1. `POST /api/agent-loops/draft` — body:
   `{"description":"Every night, check if the main branch CI is failing on open-agents; if it is, have an agent find the failing test, fix it, and open a PR. Stop after 3 attempts."}`
   → expect 200 `{name, description, definition:{nodes,edges}}` (validated + laid out
   server-side; nothing stored yet).
2. `POST /api/agent-loops` — body:
   `{"name":"Nightly green-main watch","description":"Fix CI on main overnight","repoOwner":"dennisonbertram","repoName":"open-agents","definition":<definition from step 1>,"guardrails":{"maxIterations":3,"maxStepsPerRun":40},"status":"draft"}`
   → expect 201 `{loop}`.

### Variations

- Draft, edit a node's `instructions` client-side, then create — same call count.
- Create with `status:"active"` directly to skip the later activation PATCH (STORY-04).

### Edge Cases

- **Validation failure**: `{"description":"fix ci"}` (7 chars, min is 8) → 400
  `{errorKind:"invalid_request",message:"Provide a `description` of the loop (8–2000 characters)."}`
- **Validation failure (malformed body)**: non-JSON payload → 400 `{error:"Invalid JSON body"}`.
- **Model returned junk**: unparseable / wrong-shape / invalid-graph model output → 422
  with `errorKind` of `draft_unparseable` or `draft_invalid` (the latter includes `errors[]`).
- **Upstream failure**: gateway unreachable or 45s timeout → 502 `{errorKind:"draft_failed"}`.
- **Feature disabled** → 403 `feature_disabled`. **Auth failure** → 401.

---

## STORY-agent-loops-03: Hand-author a loop and fix a rejected definition

**Type**: short
**Persona**: Priya, an SRE who wants exact control over the graph
**Goal**: Create a loop from a hand-written definition, recovering from a validation rejection
**Preconditions**: Authenticated; flag on
**Ideal path**: 1 call on the happy path (create is a single POST). The story spends 3
because the first attempt is intentionally invalid — there is no dry-run/validate
endpoint, so the only way to validate a definition is to attempt the create.
**Alternate paths**: `POST /api/agent-loops/draft` returns a *validated* definition
without persisting — it is effectively the missing "validate" endpoint, but only for
model-generated graphs, not for a user-supplied one.

### Steps

1. `POST /api/agent-loops` — body:
   `{"name":"Dependency bump verifier","repoOwner":"dennisonbertram","repoName":"open-agents","definition":{"nodes":[{"id":"triage","kind":"agent_step","label":"Bump deps","position":{"x":0,"y":0},"instructions":"Run bun update and verify the suite."}],"edges":[]}}`
   (no `start` node) → expect 400 `{errorKind:"loop_invalid",message:"Loop definition is invalid.",errors:[…]}`
2. `POST /api/agent-loops` — body: same, with the full reusable definition above →
   expect 201 `{loop}` with `status:"draft"` (the schema default when omitted).
3. `GET /api/agent-loops?repoOwner=dennisonbertram&repoName=open-agents` → expect 200
   `{loops:[…]}` containing the new loop.

### Variations

- `GET /api/agent-loops` with no query params → all of the user's loops. Filtering
  requires **both** `repoOwner` and `repoName`; supplying only one is silently ignored.

### Edge Cases

- **Validation failure (schema)**: missing `name` → 400 `{errorKind:"invalid_request"}`
  with a joined field-path message — a *different* errorKind from the graph-level
  `loop_invalid` in step 1. Clients must handle both.
- **Validation failure (guardrails)**: `{"guardrails":{"maxIterations":"never"}}` → 400
  `invalid_request`; guardrail numerics are strict positive ints and the object is
  `.strict()`, so unknown guardrail keys also 400.
- **Auth failure** → 401. **Feature disabled** → 403 `feature_disabled`.

---

## STORY-agent-loops-04: Activate a loop and run it manually end to end

**Type**: medium
**Persona**: Priya, continuing from her created draft loop
**Goal**: Activate the loop, start a run by hand, watch it, and confirm completion
**Preconditions**: STORY-03 created a `draft` loop (`loopId`); repo is in
`AGENT_LOOPS_ALLOWED_REPOS`
**Ideal path**: 3 calls (activate, start, read run) plus polling. Polling is unavoidable
— there is no SSE/websocket for loop runs, unlike chat.
**Alternate paths**: The run row is visible from **two** endpoints:
`GET /api/agent-loops/[loopId]/runs` (list, adds `failedStepCount`) and
`GET /api/agent-loop-runs/[runId]` (detail, adds loop summary/steps/events/watchdogs).
A third view of the same run exists at
`GET /api/account/diagnosis?source=agent_loop&id=<loopId>` (STORY-10).

### Steps

1. `PATCH /api/agent-loops/{loopId}` — body: `{"status":"active"}` → expect 200 `{loop}`
   with `status:"active"`.
2. `POST /api/agent-loops/{loopId}/runs` — body: none → expect **202**
   `{runId:"…", created:true}`.
3. `GET /api/agent-loop-runs/{runId}` → expect 200
   `{run:{status:"queued"|"running",…}, loop:{id,name,repoOwner,repoName,guardrails,sourceDeleted:false,sourceActive:true}, steps:[], events:[…], watchdogRuns:[]}`
4. `GET /api/agent-loop-runs/{runId}` (poll every ~5s) → `steps[]` grows with per-node
   step runs; `events[]` accumulates `agent-loop.step.*` events (capped at newest 200,
   with composio events merged back in).
5. `GET /api/agent-loop-runs/{runId}` → expect `run.status:"completed"`.
6. `GET /api/agent-loops/{loopId}/runs?limit=10` → expect 200 `{runs:[{…,failedStepCount:0}]}`.

### Variations

- Start while the loop is still `draft` → 409 `{errorKind:"loop_inactive"}`.
- Poll the list route instead of the detail route: cheaper, but no `steps`/`events`.
- `limit` above 200 is clamped to 200; non-numeric or ≤0 falls back to 50.

### Edge Cases

- **Conflict**: second `POST /runs` while a run is active or paused → 409
  `{errorKind:"active_run", activeRunId:"…"}`.
- **Not found**: `POST /runs` on someone else's `loopId` → 404 `{error:"Agent loop not found"}`.
- **Validation failure**: loop whose stored definition is invalid → 400 `{errorKind:"loop_invalid"}`.
- **Repo policy**: repo not allowlisted → 403 `{errorKind:"repo_not_allowed"}`; allowlist
  unset → 503 `repo_allowlist_unconfigured`; allowlist malformed → 503 `repo_allowlist_invalid`.
  Three distinct outcomes for one misconfiguration class.
- **Upstream failure**: workflow dispatch throws → **502**
  `{success:false, errorKind:"dispatch_failed", runId}` — and the run row is already
  marked `failed`. A `runId` in a 502 body is easy to mistake for success.
- **Auth failure** → 401. **Feature disabled** → 403 on both POST and GET.

---

## STORY-agent-loops-05: Pause, inspect, resume, and finish a long run

**Type**: medium
**Persona**: Maya, watching an unattended run touch production config
**Goal**: Halt a running loop mid-flight, read where it got to, then let it continue
**Preconditions**: STORY-04 produced a `running` run (`runId`)
**Ideal path**: 3 calls (pause, read, resume). The controls are already single-purpose
POSTs with no body, which is about as tight as it gets.
**Alternate paths**: `POST .../cancel` reaches a terminal state instead of a resumable
one — a different goal, not a duplicate. No alternate route exists for pause/resume.

### Steps

1. `POST /api/agent-loop-runs/{runId}/pause` — body: none → expect 200 `{success:true}`.
2. `GET /api/agent-loop-runs/{runId}` → expect 200 with `run.status:"paused"` and the
   partially populated `steps[]`.
3. `POST /api/agent-loop-runs/{runId}/pause` again → expect 409
   `{errorKind:"illegal_transition"}`.
4. `POST /api/agent-loop-runs/{runId}/resume` — body: none → expect 200 `{success:true}`.
5. `GET /api/agent-loop-runs/{runId}` → expect `run.status:"running"`, then poll to
   `"completed"`.

### Variations

- Pause → cancel instead of resume (see STORY-06).
- Pause a `queued` run (before the first step dispatches) — same 200 path.

### Edge Cases

- **Not found**: pause a run owned by another user → 404 `{error:"Loop run not found"}`
  (mapped from `RunControlError kind:"not_found"` — never 403).
- **Conflict**: resume a `completed` run → 409 `illegal_transition`.
- **Conflict (source)**: resume a run whose loop was deleted → 409
  `{errorKind:"source_deleted"}`; whose loop is no longer active → 409
  `{errorKind:"source_inactive"}`.
- **Upstream failure**: resume transitions state but the dispatch throws → 502
  `{success:false, errorKind:"dispatch_failed"}` and the run is marked `failed`.
- **Feature disabled** → 403 on the control routes, but `GET /api/agent-loop-runs/{runId}`
  in step 2 still returns 200 (no flag gate there).
- **Auth failure** → 401.

---

## STORY-agent-loops-06: Retry a failed step, then give up and cancel

**Type**: medium
**Persona**: Sam, whose fix-the-test step failed on a flaky integration suite
**Goal**: Retry the current step once; when it fails again, cancel the run and read the failure evidence
**Preconditions**: A run with a failed step run (`runId`)
**Ideal path**: 4 calls (read, retry, read, cancel) — retry has no read-free precondition,
so a read is genuinely needed to know which step is current.
**Alternate paths**: Instead of retrying, cancel and `POST /api/agent-loops/{loopId}/runs`
for a fresh run — that re-executes the whole graph rather than the current step.

### Steps

1. `GET /api/agent-loop-runs/{runId}` → expect 200 with `run.status:"failed"|"running"`
   and a `steps[]` entry with `status:"failed"`.
2. `POST /api/agent-loop-runs/{runId}/retry` — body: none → expect 200 `{success:true}`.
3. `GET /api/agent-loop-runs/{runId}` → poll; the step re-enters `running`, then fails again.
4. `POST /api/agent-loop-runs/{runId}/cancel` — body: none → expect 200 `{success:true}`.
5. `GET /api/agent-loop-runs/{runId}` → expect `run.status:"cancelled"`.
6. `GET /api/agent-loops/{loopId}/runs?limit=5` → expect the run listed with
   `failedStepCount >= 1` (this counter exists *only* on the list route, not on the
   detail route — to render "completed, 2 steps failed" honestly you need the list).

### Variations

- Retry succeeds on the second attempt → run proceeds to `completed`; skip steps 4–5.
- Cancel a `paused` run directly without retrying (2 calls).

### Edge Cases

- **Conflict**: retry a run with no retryable current step, or a `cancelled` run → 409
  `illegal_transition`.
- **Conflict (source)**: 409 `source_deleted` / `source_inactive` as in STORY-05.
- **Upstream failure**: retry's re-dispatch throws → 502 `dispatch_failed`, run marked failed.
- **Not found**: unknown `runId` → 404 `{error:"Loop run not found"}`.
- **Auth failure** → 401. **Feature disabled** → 403 on retry/cancel.

---

## STORY-agent-loops-07: Put a loop on a nightly schedule

**Type**: medium
**Persona**: Maya, moving from manual runs to unattended automation
**Goal**: Add a cron trigger, verify its humanized text, retune it, then disable it
**Preconditions**: An active loop (`loopId`) from STORY-04
**Ideal path**: 2 calls (create trigger, then read the loop detail which already
embeds triggers). The story uses more because it also edits and disables.
**Alternate paths**: **Triggers are readable from two routes** —
`GET /api/agent-loops/{loopId}` returns a `triggers[]` summary, and
`GET /api/agent-loops/{loopId}/triggers` returns the same rows plus
`humanizedSchedule` and `nextRunAt`. Redundant read paths with subtly different shapes;
the embedded one lacks `humanizedSchedule`, so a UI showing readable schedules must
call the dedicated route anyway.

### Steps

1. `POST /api/agent-loops/{loopId}/triggers` — body:
   `{"name":"Nightly 02:00 UTC","kind":"schedule.cron","schedule":"0 2 * * *","status":"enabled"}`
   → expect 201 `{trigger:{id,kind,status,schedule,humanizedSchedule:"…UTC",…}}`
2. `GET /api/agent-loops/{loopId}/triggers` → expect 200 `{triggers:[{…,humanizedSchedule,nextRunAt}]}`
   (narrow projection — `webhookSecretHash` is never exposed).
3. `GET /api/agent-loops/{loopId}` → expect 200 `{loop, triggers:[…]}` — the same trigger,
   without `humanizedSchedule`.
4. `PATCH /api/agent-loops/{loopId}/triggers/{triggerId}` — body:
   `{"schedule":"30 3 * * 1-5"}` → expect 200 `{trigger}` with the new schedule.
5. `PATCH /api/agent-loops/{loopId}/triggers/{triggerId}` — body: `{"status":"disabled"}`
   → expect 200 `{trigger:{status:"disabled"}}`.
6. `DELETE /api/agent-loops/{loopId}/triggers/{triggerId}` → expect 200 `{success:true}`.

### Variations

- Create a GitHub-event trigger instead:
  `{"name":"On PR review","kind":"github.pull_request_review","conditions":{"branches":["main"]}}`
  — allowed kinds are `github.pull_request`, `github.pull_request_review`,
  `github.deployment_status`, `github.issue`, `github.check_suite`, `schedule.cron`.
  Webhook-kind triggers are deliberately rejected for loops.
- Preset schedules `@hourly` / `@daily` / `@weekly` are accepted in place of cron.

### Edge Cases

- **Validation failure**: `{"name":"Nightly","kind":"schedule.cron"}` with no `schedule`
  → 400 `{errorKind:"trigger_invalid", errors:[{path:"schedule",…}]}`.
- **Validation failure**: `{"kind":"webhook.error",…}` → 400 `trigger_invalid`
  (`kind must be one of: …`).
- **Validation failure (strict)**: unknown key such as `{"cron":"0 2 * * *"}` → 400
  `trigger_invalid` (both trigger schemas are `.strict()`).
- **Validation failure (special-case)**: `PATCH {"schedule":null}` on a `schedule.cron`
  trigger → 400 `trigger_invalid` — "A schedule trigger needs a schedule."
- **Not found**: unknown `loopId`, or a loop owned by someone else → 404
  `{errorKind:"loop_not_found"}`. Unknown `triggerId` under an owned loop → 404
  `{errorKind:"loop_not_found", error:"Trigger not found"}` — the errorKind is
  misleadingly `loop_not_found` for a missing *trigger*.
- **Auth failure** → 401. **Feature disabled** → 403 `feature_disabled`.

---

## STORY-agent-loops-08: Full lifecycle — draft, tune guardrails, enable the watchdog, run, intervene, archive

**Type**: long
**Persona**: Priya, taking one loop from idea to a governed, scheduled automation and then retiring it
**Goal**: Exercise the whole loop surface in one sitting, including a multi-turn
intervention on a live run
**Preconditions**: Authenticated; flag on; repo allowlisted; AI Gateway reachable
**Ideal path**: ~12 calls of real intent; the rest are polls. There is no batch/compose
endpoint, and no SSE, so run observation is inherently poll-shaped.
**Alternate paths**: Steps 1–2 can be replaced by a single hand-authored
`POST /api/agent-loops` (STORY-03). Run observation can go through either the runs list
or the run detail. Loop retirement can be `PATCH status:"archived"` (reversible) or
`DELETE` (destructive) — two very different endpoints for "stop using this".

### Steps

1. `GET /api/agent-loops/readiness?owner=dennisonbertram&repo=open-agents` → 200,
   all checks `ready`.
2. `POST /api/agent-loops/draft` — body:
   `{"description":"Watch open issues labeled 'flaky-test' on open-agents, pick the oldest, reproduce it, fix it, and open a PR. Loop until no flaky-test issues remain."}`
   → 200 `{name,description,definition}`.
3. `POST /api/agent-loops` — body:
   `{"name":"Flaky test janitor","description":"Burn down flaky-test issues","repoOwner":"dennisonbertram","repoName":"open-agents","definition":<from step 2>,"guardrails":{"maxIterations":5,"maxStepsPerRun":60,"stepTimeoutMs":900000},"permissions":{"github":{"contents":"write","issues":"write","pull_requests":"write"}},"status":"draft"}`
   → 201 `{loop}`.
4. `PATCH /api/agent-loops/{loopId}` — body:
   `{"watchdogEnabled":true,"watchdogInstructions":"Stop the run if the agent edits anything outside apps/web or force-pushes.","watchdogRetryBudget":2}`
   → 200 `{loop}`.
5. `PATCH /api/agent-loops/{loopId}` — body: `{"status":"active"}` → 200 `{loop}`.
6. `POST /api/agent-loops/{loopId}/triggers` — body:
   `{"name":"Weekday mornings","kind":"schedule.cron","schedule":"0 9 * * 1-5","status":"enabled"}`
   → 201 `{trigger}`.
7. `GET /api/agent-loops/{loopId}/triggers` → 200, confirm `humanizedSchedule` and `nextRunAt`.
8. `POST /api/agent-loops/{loopId}/runs` → 202 `{runId, created:true}`.
9. `GET /api/agent-loop-runs/{runId}` → 200, `run.status:"queued"`.
10. `GET /api/agent-loop-runs/{runId}` (poll) → `running`; `steps[]` shows the
    `agent_step` node in progress; `watchdogRuns:[]` still empty.
11. `GET /api/agent-loop-runs/{runId}` (poll) → `watchdogRuns[]` gains a decision row.
12. `POST /api/agent-loop-runs/{runId}/pause` → 200 `{success:true}`.
13. `GET /api/agent-loop-runs/{runId}` → `paused`; read `events[]` for the step's evidence.
14. `PATCH /api/agent-loops/{loopId}` — body: `{"guardrails":{"maxIterations":3,"maxStepsPerRun":40}}`
    → 200 `{loop}` (note: guardrail edits do not retroactively change the paused run).
15. `POST /api/agent-loop-runs/{runId}/resume` → 200 `{success:true}`.
16. `GET /api/agent-loop-runs/{runId}` (poll to terminal) → `completed` or `failed`.
17. `GET /api/agent-loops/{loopId}/runs?limit=20` → 200 `{runs:[{…,failedStepCount}]}`.
18. `PATCH /api/agent-loops/{loopId}/triggers/{triggerId}` — body: `{"status":"disabled"}` → 200.
19. `PATCH /api/agent-loops/{loopId}` — body: `{"status":"archived"}` → 200 `{loop}`.
20. `POST /api/agent-loops/{loopId}/runs` → 409 `{errorKind:"loop_inactive"}` — archived
    loops cannot start runs.

### Variations

- Replace step 19–20 with `DELETE /api/agent-loops/{loopId}` → 200 `{success:true}`;
  afterwards, control calls on any still-live run of that loop return 409
  `{errorKind:"source_deleted"}` and the run detail reports `loop.sourceDeleted:true`.
- Skip the watchdog (step 4) entirely — `watchdogRuns[]` stays empty throughout.

### Edge Cases

- **Validation failure**: `PATCH {"watchdogRetryBudget":9}` → 400 `invalid_request`
  (bounded 0–5).
- **Validation failure**: `PATCH {"statuss":"active"}` → 400 `invalid_request`
  (update body is `.strict()`).
- **Conflict**: a second `POST /runs` between steps 8 and 16 → 409 `active_run`
  (paused counts as active).
- **Not found**: any `PATCH`/`DELETE` after the loop is deleted → 404
  `{error:"Agent loop not found"}`.
- **Auth failure** → 401 everywhere. **Feature disabled** → 403 on all steps except 9–11
  and 13/16 (run detail has no flag gate).

---

## STORY-agent-loops-09: Operator sweeps stalled runs on a cron

**Type**: short
**Persona**: The deployment's cron scheduler (service-to-service), and Maya debugging it by hand
**Goal**: Mark runs stalled when their latest event is older than `AGENT_LOOPS_STALL_MINUTES`
**Preconditions**: `CRON_SECRET` or `BACKGROUND_AGENTS_CRON_SECRET` configured; at least
one `queued`/`running` run with a stale latest event
**Ideal path**: 1 call — the sweep is a single idempotent maintenance call.
**Alternate paths**: **`GET` and `POST` on `/api/agent-loops/sweep` are literally the
same handler** (`handleSweep`) — two methods, one behavior, a genuine redundancy.
The user-facing consequence of a sweep is also visible via
`GET /api/agent-loop-runs/{runId}` (status flips to stalled/failed).

### Steps

1. `POST /api/agent-loops/sweep` — header:
   `Authorization: Bearer $BACKGROUND_AGENTS_CRON_SECRET`; body: none → expect 200
   `{stalledCount: 1, checkedCount: 4}`.
2. `GET /api/agent-loop-runs/{runId}` (as the run's owner) → expect the swept run to no
   longer be `running`.

### Variations

- `GET /api/agent-loops/sweep` with the same header → identical response.
- Header form `x-background-agents-cron-secret: <secret>` instead of the bearer token
  → identical response.
- Nothing stale → 200 `{stalledCount:0, checkedCount:N}`.

### Edge Cases

- **Auth failure**: no header, or a wrong secret → 401 `{error:"Unauthorized"}`.
  Note this route ignores user sessions entirely — a logged-in user cannot sweep.
- **Misconfiguration**: neither `CRON_SECRET` nor `BACKGROUND_AGENTS_CRON_SECRET` set →
  **500** `{error:"CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured"}`,
  checked *before* the auth comparison.
- **Not found / validation**: none — the route takes no parameters and no body.

---

## STORY-agent-loops-10: Diagnose "why did my loop stop doing anything?"

**Type**: medium
**Persona**: Sam, back on Monday, whose scheduled loop hasn't produced a PR in days
**Goal**: Work out whether the cause is the trigger, the allowlist, the loop status, or a failing run
**Preconditions**: A loop with a `schedule.cron` trigger and several historical runs
**Ideal path**: 2 calls — `GET /api/account/diagnosis?source=agent_loop&id=<loopId>` is
built to be the one-shot cross-subsystem answer, with a readiness check for config.
The story takes more because the diagnosis output still has to be corroborated against
the loop's own routes.
**Alternate paths**: The same failure story can be reconstructed entirely from loop
routes (steps 2–5 below) without touching `/api/account/diagnosis` — a full duplicate
read path over the same rows. Trigger state is again available from both
`GET /api/agent-loops/{loopId}` and `GET /api/agent-loops/{loopId}/triggers`.

### Steps

1. `GET /api/account/diagnosis?source=agent_loop&id={loopId}&limit=20` → expect 200
   diagnosis payload for the loop.
2. `GET /api/agent-loops/{loopId}` → expect 200 `{loop:{status:"paused"|"archived"|"active"},triggers:[…]}`.
3. `GET /api/agent-loops/{loopId}/triggers` → expect 200; check `status:"disabled"` or a
   `nextRunAt` in the past.
4. `GET /api/agent-loops/{loopId}/runs?limit=20` → expect 200 `{runs:[…]}`; look for the
   last run's `status` and `failedStepCount`.
5. `GET /api/agent-loop-runs/{lastRunId}` → expect 200 `{run,loop,steps,events,watchdogRuns}`;
   read `events[]` for the failing step's evidence.
6. `GET /api/agent-loops/readiness?owner=dennisonbertram&repo=open-agents` → expect 200;
   a `repo_access.status:"disabled"` here explains silent non-dispatch that none of the
   loop routes surface on their own.
7. Remediate: `PATCH /api/agent-loops/{loopId}` — body: `{"status":"active"}` → 200, then
   `POST /api/agent-loops/{loopId}/runs` → 202 `{runId, created:true}`.

### Variations

- If the last run is stuck `running` with stale events, the real cause is a missing sweep
  cron (STORY-09) rather than anything in the loop config.
- If step 5 shows `loop.sourceDeleted:true`, the loop was deleted while a run was live;
  controls on that run return 409 `source_deleted`.

### Edge Cases

- **Validation failure**: `?source=agent-loop` (hyphen) → 400
  `{error:"Invalid source", supportedSources:["session","chat_workflow","background_agent","agent_loop"]}`.
- **Validation failure**: missing `id` → 400 `{error:"Missing id"}`.
- **Not found**: a `loopId` owned by another user → 404 `{error:"Work item not found"}`
  from diagnosis, and 404 `{error:"Agent loop not found"}` from the loop route — two
  different 404 bodies for the same condition.
- **Auth failure** → 401 on every step.
- **Feature disabled**: `/api/account/diagnosis` has no loop feature-flag gate and still
  answers, while steps 2–4 and 7 return 403 `feature_disabled`.

---

## Cross-cutting redundancy notes

- **Same run data, three endpoints**: `GET /api/agent-loops/{loopId}/runs` (list +
  `failedStepCount`), `GET /api/agent-loop-runs/{runId}` (detail + steps/events/watchdogs,
  **no** `failedStepCount`), and `GET /api/account/diagnosis?source=agent_loop&id=…`.
  No single endpoint gives both a run's step timeline and its failed-step count.
- **Same trigger data, two endpoints**: embedded in `GET /api/agent-loops/{loopId}` and
  standalone at `GET /api/agent-loops/{loopId}/triggers` (the standalone one adds
  `humanizedSchedule`, so the embedded copy is nearly always insufficient).
- **`GET` and `POST /api/agent-loops/sweep` share one handler** — identical behavior on
  two methods.
- **Two ways to learn a repo isn't allowlisted**: `GET /api/agent-loops/readiness`
  (proactive) and a failed `POST /api/agent-loops/{loopId}/runs` (403/503, reactive).
- **Inconsistent gating**: every loop route 403s on `feature_disabled` except
  `GET /api/agent-loop-runs/{runId}`, `GET /api/agent-loops/readiness`,
  `/api/agent-loops/sweep`, and `/api/account/diagnosis`.
- **Inconsistent error keys**: trigger routes return `errorKind:"loop_not_found"` even
  when it is the *trigger* that is missing; create returns `invalid_request` for schema
  errors but `loop_invalid` for graph errors.
