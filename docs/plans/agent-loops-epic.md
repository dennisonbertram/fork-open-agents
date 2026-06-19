# Agent Loops — Implementation Plan

> **Epic:** [#319 — Agent Loops](https://github.com/dennisonbertram/fork-open-agents/issues/319)
> (slices [#320–#336](https://github.com/dennisonbertram/fork-open-agents/issues/319))
> **Context briefing:** [loop-tool-context.md](loop-tool-context.md)

Agent Loops is a deterministic orchestration harness for background-agent-style
work. A user designs a loop as a graph of nodes (check GitHub for issues → take
issue → implement → review → PR → confirm → repeat), the loop runs in the
background with durable execution, and a watchdog agent diagnoses and repairs
failed steps.

Canonical example loop:

```
start → github_check (open issues?) → condition (issues found?)
      → agent_step (claim + implement) → agent_step (review)
      → agent_step (open PR) → github_check (CI/deploy status)
      → edge back to start (next iteration)
```

---

## 1. Decisions Made (with rationale)

These were decided with the user on 2026-06-11:

| Decision | Choice | Rationale |
|---|---|---|
| Sandbox strategy | **Fresh sandbox per step** | Survives long-running loops, each step is a clean durable checkpoint, maximally reuses the background-agent execution shape. GitHub state (issue #, branch, PR #) + a context JSONB carries state between steps. |
| Milestone order | **Executor first** | M1: schema + engine + API + minimal UI. M2: React Flow builder + live view. M3: watchdog. The risky part (durable graph execution) is proven before UI investment. |
| Watchdog | **On-failure + stall sweep** | Watchdog agent invoked only when a step fails or a run stalls. Cheap, deterministic. Continuous review sidecar is a possible v2. |
| Approval gates | **Not in v1** | Loops run fully autonomously; only user-initiated pause. `wait_approval` nodes are a v2 follow-up (schema leaves room). |

Decisions made during planning (technical, overridable in review):

| Decision | Choice | Rationale |
|---|---|---|
| Durable execution shape | **One durable workflow run per STEP, chained** (not one long workflow per loop run) | Matches the existing background-agent pattern exactly (`start(workflow, [{runId}])` per unit of work). Pause = don't enqueue next; resume/retry = re-dispatch a step; a crashed step never takes down a whole loop-run function. DB loop-run row is the source of truth; workflows are stateless executors. The `workflow` package is beta — short-lived workflow functions are the lower-risk usage. |
| Loop-back representation | **Edges to earlier nodes ARE the loop** — no special `loop_back` node kind | Simpler model. Cycles are bounded by run guardrails (`maxSteps`, `maxIterations`). |
| Executor reuse strategy | **New `lib/agent-loops/step-executor.ts` built on shared lower-level primitives; no refactor of `background-agents/executor.ts` in the M1 critical path** | The background-agent executor is a 1,225-line module with one export — all helpers are private. Extracting them is a behavior-preserving refactor of a shipped system; do it opportunistically (see M1-07), not as a blocker. |
| Trigger reuse | **Extend `backgroundAgentTriggers` with nullable `loopId`; relax `agentId` to nullable; DB check constraint: exactly one of (agentId, loopId) set** | Full reuse of webhook routes, HMAC verification, cron sweep, schedule presets, condition matching, and idempotency. Alternative (separate `agentLoopTriggers` table) duplicates the dispatch path; rejected. |
| Definition versioning | **Snapshot the definition JSONB onto the run at start** | In-flight runs execute the definition as of run start; edits affect only future runs. |
| Concurrency | **One active run per loop** (enforced at dispatch: skip + event if a run is already queued/running) | Prevents two iterations racing on the same repo. Multi-run loops are a later opt-in. |
| Step output contract | **Agent writes JSON to a well-known sandbox path (`/tmp/loop-step-output.json`); executor reads, validates, merges into run context under the node id** | Deterministic; no parsing of model prose. github_check / condition nodes write context directly. |
| Condition language | **Structured comparisons, no expression strings**: `{ path: "github_check_1.openIssueCount", op: "gt", value: 0 }` with ops `eq/neq/gt/gte/lt/lte/exists/contains` | No eval, no parser, trivially testable, renders naturally as form fields in the M2 builder. |
| Live view transport | **SWR polling (2s) in M1/M2**, SSE later if needed | Matches the existing background-run detail page pattern; avoids new infra. |

---

## 2. Architecture

```
                ┌────────────────────────────────────────────────┐
                │ TRIGGERS (reused from background agents)        │
                │ github.* webhooks · schedule.cron · webhook.err │
                │ + manual start via API                          │
                └───────────────┬────────────────────────────────┘
                                ▼
   dispatcher: trigger matched → loop bound? ──→ existing agent path (unchanged)
                                │ yes
                                ▼
   create agentLoopRuns row (definition snapshot, context={}, currentNodeId=start)
   create agentLoopStepRuns row for start node
   start(runAgentLoopStepWorkflow, [{ stepRunId }])          ← durable
                                │
              ┌─────────────────▼──────────────────┐
              │ STEP WORKFLOW (one per step)        │
              │ 1. cooperative check: run still     │
              │    running? (pause/cancel honored)  │
              │ 2. guardrails: maxSteps/maxIter/    │
              │    wall-clock budget                │
              │ 3. execute node by kind:            │
              │    agent_step  → fresh sandbox,     │
              │      clone, openAgent, commit/push, │
              │      read output JSON, dispose      │
              │    github_check → GitHub API call,  │
              │      no LLM                         │
              │    condition   → evaluate against   │
              │      context, no LLM, no sandbox    │
              │    end         → finalize run       │
              │ 4. persist step result + events     │
              │ 5. merge output into run context    │
              │ 6. evaluate outgoing edges →        │
              │    next node                        │
              │ 7. create next stepRun + start its  │
              │    workflow (the chain)             │
              └─────────────────┬──────────────────┘
                                │ on step failure
                                ▼
              M1: run → failed (paused-equivalent), user inspects/retries
              M3: watchdog agent diagnoses → retry / skip / pause+notify
              stall sweep (cron): no event for N min → mark stalled
```

State between steps lives in two places:

- **`agentLoopRuns.context` JSONB** — structured, keyed by node id
  (`{ "check_issues": { "openIssueCount": 3, "issues": [...] }, "implement": { "branch": "...", "prNumber": 42 } }`).
  Edges and conditions route on this. Size-capped (64KB) with explicit
  truncation events.
- **GitHub** — the durable workspace state. The implement step pushes a branch;
  the review step clones that branch fresh. Uncommitted sandbox state is never
  relied on across steps.

---

## 3. Data Model

New tables in `apps/web/lib/db/schema.ts` (migration must be idempotent — see
Neon preview lesson):

### `agentLoops`
| column | type | notes |
|---|---|---|
| id | text PK | |
| userId | text FK→users cascade | |
| name | text notNull | |
| description | text | |
| repoOwner / repoName | text notNull | loops are repo-scoped in v1, like background agents |
| definition | jsonb notNull | `{ nodes: LoopNode[], edges: LoopEdge[] }`, zod-validated on write |
| status | enum draft \| active \| paused \| archived | only `active` loops accept triggers |
| guardrails | jsonb | `{ maxStepsPerRun?: number, maxIterations?: number, maxRunDurationMs?: number, stepTimeoutMs?: number }` with server-enforced ceilings |
| permissions | jsonb | same shape as backgroundAgents.permissions |
| createdAt / updatedAt | timestamp | |

Indexes: userId; (repoOwner, repoName); status.

### `agentLoopRuns`
| column | type | notes |
|---|---|---|
| id | text PK | |
| loopId | text FK→agentLoops cascade | |
| userId | text FK→users cascade | |
| status | enum queued \| running \| paused \| completed \| failed \| cancelled \| stalled | |
| definitionSnapshot | jsonb notNull | frozen copy of loop.definition at start |
| currentNodeId | text | |
| currentStepRunId | text | |
| iterationCount | integer default 0 | incremented when an edge targets an already-visited node in this run |
| stepCount | integer default 0 | total steps executed |
| context | jsonb default {} | shared state, keyed by node id |
| source | enum github \| schedule \| webhook \| manual | |
| triggerId | text FK→backgroundAgentTriggers set-null | reused trigger table |
| idempotencyKey | text unique | same scheme as background agents |
| errorKind / errorMessage | text | typed taxonomy |
| workflowRunId | text | most recent step's workflow run (correlation) |
| requestId | text | |
| startedAt / finishedAt | timestamp | |

Indexes: (loopId, createdAt); (userId, createdAt); status.

### `agentLoopStepRuns`
| column | type | notes |
|---|---|---|
| id | text PK | |
| loopRunId | text FK→agentLoopRuns cascade | |
| nodeId | text notNull | references node in definitionSnapshot |
| nodeKind | text notNull | denormalized for queries |
| attempt | integer default 1 | bumped on retry (M3 watchdog) |
| status | enum queued \| running \| succeeded \| failed \| skipped | |
| stepInput | jsonb | context slice given to the step |
| stepOutput | jsonb | validated output merged into run context |
| sandboxName | text | `agent_loop_<stepRunId>` (agent_step only) |
| workflowRunId | text | durable workflow correlation |
| errorKind / errorMessage | text | |
| startedAt / finishedAt / durationMs | | |

Indexes: (loopRunId, createdAt); unique (loopRunId, nodeId, attempt).

### `agentLoopEvents`
Mirror of `backgroundAgentEvents`: id, loopRunId FK, stepRunId nullable, nodeId
nullable, eventName, status, level, summary, payload jsonb (through the same
redaction pipeline), requestId, workflowRunId, redactionStatus, createdAt.
Indexes: (loopRunId, createdAt); requestId.

### `agentLoopWatchdogRuns` (M3)
id, loopRunId FK, stepRunId FK, status, diagnosis text, decision enum
retry \| skip \| pause, decisionPayload jsonb, startedAt/finishedAt.

### Trigger table change
`backgroundAgentTriggers`: add nullable `loopId` text FK→agentLoops cascade;
relax `agentId` to nullable; add check constraint
`num_nonnulls(agent_id, loop_id) = 1`. Audit existing queries that join
triggers→agents to tolerate loop-bound rows (dispatcher, settings UI, cron
sweep).

---

## 4. Node & Edge Spec (v1)

```ts
type LoopNodeKind = "start" | "agent_step" | "github_check" | "condition" | "end";

type LoopNode = {
  id: string;                      // unique within definition
  kind: LoopNodeKind;
  label: string;
  position: { x: number; y: number };   // React Flow; ignored by executor
  // agent_step only:
  instructions?: string;           // step prompt; context injected by executor
  outputSchema?: JsonSchemaLite;   // optional validation of step output JSON
  checkCommand?: string;           // optional post-step check (reuses pattern)
  // github_check only:
  check?:
    | { kind: "list_issues"; labels?: string[]; state?: "open" | "closed" }
    | { kind: "pr_status"; prNumberFrom: string /* context path */ }
    | { kind: "deployment_status"; environment?: string }
    | { kind: "ci_status"; refFrom: string /* context path */ };
  // condition only:
  condition?: { path: string; op: "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"exists"|"contains"; value?: unknown };
};

type LoopEdge = {
  id: string;
  source: string;                  // node id
  target: string;                  // node id (may be an earlier node = loop)
  when: "success" | "failure" | "true" | "false" | "always";
  // condition nodes use true/false; other nodes use success/failure/always
};
```

**Graph validation rules** (zod + custom, enforced on save and on run start):
exactly one `start`; ≥1 `end`; all edge endpoints exist; every non-end node has
≥1 outgoing edge; condition nodes have both `true` and `false` edges; no
duplicate `(source, when)` pairs; `end` reachable from `start`; definition size
cap. Cycles are explicitly allowed.

**Routing:** after a step finishes, the executor picks the edge matching the
outcome (`success`/`failure` for agent_step and github_check, `true`/`false`
for condition, `always` as fallback). A failed step with no `failure` edge
fails the run (M1) / invokes the watchdog (M3).

---

## 5. Execution Engine

New module `apps/web/lib/agent-loops/`:

- `types.ts` — LoopDefinition zod schemas, error taxonomy
  (`loop_invalid`, `guardrail_exceeded`, `step_output_invalid`,
  `sandbox_unavailable`, `github_check_failed`, `chain_dispatch_failed`, …)
- `validation.ts` — graph validation
- `store.ts` — CRUD + run/step/event persistence (mirrors background-agents/store.ts)
- `context.ts` — context merge, size cap, path lookup for conditions/`*From` refs
- `edge-evaluator.ts` — pure function `(definition, nodeId, outcome) → nextNodeId | null`
- `step-executor.ts` — executes one step run:
  - **agent_step**: verify repo access → mint GitHub App token → `connectSandbox`
    (name `agent_loop_<stepRunId>`) → clone/checkout (branch from context if the
    step declares one) → build prompt (instructions + serialized context slice +
    output-contract instructions) → `openAgent` (classic tool policy, step
    timeout) → read/validate `/tmp/loop-step-output.json` → optional
    checkCommand → commit/push if the step produced changes → dispose sandbox
  - **github_check**: typed GitHub API call with the App installation token,
    output written straight to context — no LLM, no sandbox
  - **condition**: pure evaluation against context — no LLM, no sandbox, no I/O
  - **end**: finalize run (status completed, finishedAt)
- `chain.ts` — post-step: cooperative pause/cancel check, guardrail check,
  edge evaluation, create next stepRun, `start(runAgentLoopStepWorkflow, …)`
- `dispatcher-bridge.ts` — hooks into the background-agent dispatcher for
  loop-bound triggers (create run with idempotency, dispatch first step)

New durable workflow `apps/web/app/workflows/agent-loop-step.ts`:

```ts
import { getWorkflowMetadata } from "workflow";
import { executeAgentLoopStep } from "@/lib/agent-loops/step-executor";

export async function runAgentLoopStepWorkflow(input: { stepRunId: string }) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await executeAgentLoopStep({ stepRunId: input.stepRunId, workflowRunId });
}
```

**Pause/cancel:** API sets run status; the chain checks status before
dispatching the next step and the step executor checks before starting work.
Pause takes effect at the next step boundary (documented behavior). Resume
re-dispatches `currentStepRunId` (or the next node if the current step
completed).

**Guardrails:** server-side ceilings regardless of user config —
maxStepsPerRun (default 50, ceiling 200), maxIterations (default 10, ceiling
50), maxRunDurationMs (default 2h), stepTimeoutMs (default 10m, ceiling 30m).
Tripping a guardrail fails the run with `guardrail_exceeded` + event.

**Stall sweep:** extend the existing background-agents cron route (or a
sibling route under the same secret) to find runs with status running/queued
and no event for N minutes (default 15) → mark `stalled` + event. M3 routes
stalled runs to the watchdog.

---

## 6. API Surface

```
POST   /api/agent-loops                          create (validates definition)
GET    /api/agent-loops?repoOwner=&repoName=     list
GET    /api/agent-loops/[loopId]                 get (definition + trigger summary)
PATCH  /api/agent-loops/[loopId]                 update definition/status/guardrails
DELETE /api/agent-loops/[loopId]                 delete (cascade)

POST   /api/agent-loops/[loopId]/runs            manual start (409 if a run is active)
GET    /api/agent-loops/[loopId]/runs            run history
GET    /api/agent-loop-runs/[runId]              run + steps + events (poll target)
POST   /api/agent-loop-runs/[runId]/pause
POST   /api/agent-loop-runs/[runId]/resume
POST   /api/agent-loop-runs/[runId]/cancel
POST   /api/agent-loop-runs/[runId]/retry        re-dispatch failed current step (manual recovery in M1)
```

All routes `requireAuthenticatedUser()` + ownership checks, mirroring the
background-agent routes. Trigger CRUD reuses the existing background-agent
trigger management with a loop target.

**Feature flags:** `AGENT_LOOPS_ENABLED` (global), `AGENT_LOOPS_ALLOWED_REPOS`
(rollout allowlist) — same pattern as background agents. Readiness surfaced via
the existing readiness endpoint pattern.

---

## 7. UI

**M1 (minimal, ships with the engine):**
- `/loops` — list page: loop cards (name, repo, status, last run), create
  button → form with name/repo/guardrails + a JSON definition editor
  (validated client- and server-side). Deliberately not the visual builder yet.
- `/loops/[loopId]` — loop detail: definition (read-only JSON), trigger
  summary, run history table, Run Now / Pause loop buttons.
- `/loops/[loopId]/runs/[runId]` — run detail: status strip (mirrors
  background-run proof strip), step timeline with per-step status/duration/
  output summary, event log, pause/resume/cancel/retry actions. SWR polling
  while active.

**M2 (visual builder + live view):** add `@xyflow/react`.
- `/loops/[loopId]/builder` — React Flow canvas: node palette (agent_step,
  github_check, condition, end), drag to add, connect edges with `when`
  labels, click node → config side panel (instructions editor, check picker,
  condition form), inline validation errors, save → definition JSONB.
  Round-trips the same definition the JSON editor produces.
- Run detail gains a live graph: read-only canvas, current node pulsing,
  completed nodes green / failed red, edge taken highlighted per iteration.

Component conventions: Radix + Tailwind 4 + CVA per the existing `components/ui`
pattern; builder lives in colocated files under `app/loops/` per the
file-organization rules.

---

## 8. Milestones & Issue Breakdown

Each issue follows the feature ticket format (observability, regression
harness, protected path, tests-first, deploy impact, DoD). PR-sized.

### M1 — Loop Engine (executor-first)
| # | Issue | Scope |
|---|---|---|
| M1-01 | Schema + migration | 4 tables + trigger table change + idempotent SQL + store CRUD |
| M1-02 | Definition types + graph validation | types.ts, validation.ts, exhaustive unit tests |
| M1-03 | Edge evaluator + context + condition evaluation | pure modules, property-style tests (cycles, fallbacks, missing paths) |
| M1-04 | Step executor: github_check + condition + end | no-LLM nodes first — engine proven cheap |
| M1-05 | Step executor: agent_step | sandbox lifecycle, output contract, checkCommand, commit/push |
| M1-06 | Chain + durable workflow + guardrails + pause/cancel/retry | chain.ts, agent-loop-step.ts, cooperative cancellation |
| M1-07 | Trigger integration | dispatcher branch for loop-bound triggers, manual start, idempotency, single-active-run rule |
| M1-08 | API routes | CRUD + run management + flags + readiness |
| M1-09 | Minimal UI | /loops list, detail, run detail with timeline + actions |
| M1-10 | Stall sweep + observability pass | cron sweep, event taxonomy complete, redaction verified, live proof per managed-runtime-proof-standard analog |

### M2 — Visual Builder + Live View
| # | Issue | Scope |
|---|---|---|
| M2-01 | Add @xyflow/react + builder canvas (read/layout/save round-trip) | |
| M2-02 | Node config panels + edge editing + inline validation | |
| M2-03 | Live run graph view (polling-driven highlights) | |
| M2-04 | Builder ⇄ JSON editor parity + authenticated UI smoke | |

### M3 — Watchdog
| # | Issue | Scope |
|---|---|---|
| M3-01 | Watchdog schema + invocation on step failure | watchdog agent (openAgent, read-only tools + structured decision output: retry/skip/pause), retry budget per node (default 2) |
| M3-02 | Stalled-run routing + watchdog decision events in run UI | |
| M3-03 | Watchdog live proof + tuning | evidence per proof standard |

**v2 backlog (explicitly out of scope):** approval/wait nodes, notifications,
shared-sandbox burst optimization, concurrent runs per loop, Composio tool
nodes, loop templates, workflow-catalog registration.

---

## 9. Testing Strategy (behavior-first TDD)

**Protected paths:**
1. A valid loop definition executes nodes in edge order and completes at `end`.
2. A failed step with no failure edge fails the run with a typed errorKind and
   stops the chain (no runaway dispatch).
3. Guardrails halt infinite cycles (`maxIterations`/`maxSteps`).
4. Pause/cancel is honored at the next step boundary; resume continues from
   `currentStepRunId`.
5. Duplicate trigger deliveries do not start duplicate runs (idempotency), and
   a second trigger while a run is active is skipped with an event.
6. Existing background-agent trigger dispatch is unchanged (regression suite
   must stay green through the trigger-table migration).

Test layers, mirroring background-agents tests: pure-unit (validation, edge
evaluator, condition, context merge — no mocks needed); executor tests with
mocked `workflow/api` `start` (established pattern:
`mock.module("workflow/api", …)`), mocked sandbox and GitHub clients; API route
tests; migration idempotency test. Each bug found during build gets a
regression test per regression discipline.

## 10. Observability

Service `agent-loops`. Events: `agent-loop.run.created`, `.run.started`,
`.step.started`, `.step.completed`, `.step.failed`, `.edge.evaluated`,
`.context.merged` (+truncation flag), `.guardrail.tripped`, `.chain.dispatched`,
`.chain.dispatch_failed`, `.run.paused/.resumed/.cancelled`,
`.run.completed/.failed/.stalled`, M3: `.watchdog.started/.decided`.
Correlation fields: loopId, loopRunId, stepRunId, nodeId, attempt,
workflowRunId, sandboxName, requestId, idempotencyKey. All payloads through the
existing redaction pipeline with redactionStatus persisted. Run detail UI is
the user-visible evidence surface (proof strip + timeline), matching the
background-run page standard.

## 11. Debug Recipes

Common investigation starting points for production incidents.

### Stalled run investigation

A run shows `status=stalled` in the UI:

```bash
# Find recent stalled runs with their last event
SELECT r.id, r.loop_id, r.status, r.error_kind, r.error_message,
       MAX(e.created_at) AS last_event_at,
       EXTRACT(EPOCH FROM (now() - MAX(e.created_at)))/60 AS minutes_since_event
FROM agent_loop_runs r
LEFT JOIN agent_loop_events e ON e.loop_run_id = r.id
WHERE r.status = 'stalled'
GROUP BY r.id
ORDER BY r.created_at DESC LIMIT 20;
```

Then check the sweep log for the sweep.completed event that caught it:
- Server logs: grep for `[agent-loop.sweep.completed]` — shows `stalledCount`, `checkedCount`, `thresholdMinutes`
- Events table: `SELECT * FROM agent_loop_events WHERE loop_run_id='<runId>' AND event_name IN ('agent-loop.run.stalled', 'agent-loop.sweep.completed') ORDER BY created_at;`

Manual sweep trigger (requires `BACKGROUND_AGENTS_CRON_SECRET`):
```bash
curl -X POST https://<host>/api/agent-loops/sweep \
  -H "Authorization: Bearer $BACKGROUND_AGENTS_CRON_SECRET"
```

### Cancel race investigation

A run shows `status=cancelled` but no events after the cancel event:

Check for `chain.skipped` event — this is the cooperative-skip path that fires when the queued→running conditional transition returns 0 rows:
```sql
SELECT * FROM agent_loop_events
WHERE loop_run_id = '<runId>'
  AND event_name = 'agent-loop.chain.skipped'
ORDER BY created_at;
```

If present, the race fix worked correctly (cancel was honored). The payload includes `reason: "queued_to_running_race"`.

### Dispatch failure investigation

Events to check: `agent-loop.chain.dispatch_failed` — payload includes the `error` field with the start() exception message.

### Observability correlation

All events include `loopRunId` and `loopId`. For a full run timeline:
```sql
SELECT event_name, level, summary, created_at, payload
FROM agent_loop_events
WHERE loop_run_id = '<runId>'
ORDER BY created_at;
```

## 12. Risks

| Risk | Mitigation |
|---|---|
| `workflow` package is beta; chain dispatch could drop a link | Stall sweep catches orphaned runs; `chain.dispatch_failed` event + retry endpoint; chain dispatch happens inside the durable step workflow so it is checkpointed |
| Trigger table migration touches a live system | Nullable adds only + check constraint; regression suite on dispatcher; idempotent SQL (Neon preview lesson) |
| Step output contract drift (agent doesn't write the file) | Executor treats missing/invalid output as step failure with `step_output_invalid`; prompt includes explicit contract; outputSchema validation optional per node |
| Runaway cost from cycles | Hard server-side ceilings independent of user config; single-active-run rule; per-step timeout |
| Context JSONB bloat | 64KB cap with truncation events; large artifacts belong in GitHub (branches/PRs), not context |
