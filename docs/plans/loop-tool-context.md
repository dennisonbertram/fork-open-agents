# Loop Tool — Context Briefing

> **Status: historical context snapshot (pre-decision).** This briefing grounded the planning conversation; the canonical spec is [agent-loops-epic.md](agent-loops-epic.md) and epic [#319](https://github.com/dennisonbertram/fork-open-agents/issues/319). Where they differ, the epic wins — notably: there is **no `loop_back` node kind** (edges targeting earlier nodes form cycles), **`wait`/approval nodes are deferred to v2**, and node/edge definitions live in the **`agentLoops.definition` JSONB** (there is no `agentLoopNodes` table). Do not implement from this document.

This document synthesizes all existing system context needed to design and build a "loop" tool for open-agents. A loop is a user-defined, deterministic sequence of agent-powered steps (e.g. start → check GitHub issues → take issue → implement → review → PR → push to prod → confirm → repeat). The loop runs in the background and has a watchdog agent that monitors and repairs it.

---

## 1. What the User Wants to Build

A visual pipeline builder where users:
1. Design a loop as a **graph of nodes** (each node = an agent step, e.g. "check GitHub for issues", "implement fix", "open PR")
2. Define **edges** (transitions: next step on success, error path, loop-back)
3. **Run the loop in the background** (deterministic, supervised execution)
4. A **watchdog agent** watches the live run and can diagnose/fix issues when steps fail

Example loop the user described:
```
start → check GitHub for issues → take issue → implement → review → PR → push to prod → confirm → check GitHub for issues (repeat)
```

Key properties:
- **Deterministic**: steps execute in defined order, not model-driven routing
- **Visual**: built with React Flow (not yet installed, needs to be added)
- **Background execution**: reuses existing background agent sandbox infra
- **Watchdog**: a separate agent process that monitors the run and can intervene

---

## 2. What Is Already Built

### 2.1 Background Agents System (FULLY SHIPPED)

The most relevant existing system. Background agents are trigger-based autonomous sandbox runs.

**Architecture:**
- `apps/web/lib/background-agents/` — dispatcher, executor, store, config, types
- `apps/web/app/api/background-agents/` — REST API (CRUD + cron + webhook + test)
- `apps/web/app/workflows/background-agent.ts` — durable workflow entry point
- UI at `/settings/background-agents` and `/repos/[owner]/[repo]/agents`

**Execution path:**
```
Trigger (GitHub webhook / cron / manual) 
  → dispatcher creates run record with idempotency key
  → workflow/api.start(runBackgroundAgentWorkflow, [{ runId }])  ← durable workflow
  → executor: verify repo access → mint GitHub token → connectSandbox → run openAgent → commit → open PR
  → events persisted to backgroundAgentEvents (immutable timeline)
```

**The `workflow` package** (`v4.2.0-beta.72` — Vercel's durable workflow runtime):
- Functions marked with `"use workflow"` directive become durable, resumable workflows
- `workflow/api.start(workflowFn, [args])` — starts a workflow run, returns workflowRunId
- `getWorkflowMetadata()` — inside a workflow, returns the durable `workflowRunId`
- This is how background agents achieve durability. **The loop runner should use the same pattern.**

**DB tables** (all in `apps/web/lib/db/schema.ts`):
- `backgroundAgents` — configuration (name, instructions, permissions, outputMode, checkCommand)
- `backgroundAgentTriggers` — when to fire (kind: github.pull_request, schedule.cron, etc.)
- `backgroundAgentRuns` — one row per execution (status, idempotencyKey, sandboxName, errorKind)
- `backgroundAgentEvents` — immutable event timeline (eventName, status, level, summary, payload)
- `backgroundAgentOutputs` — what was produced (PR URL, comment, etc.)

**Sandbox connection:**
```ts
connectSandbox({ name: "background_agent_<runId>", ... })  // from @open-agents/sandbox
```
Wraps Vercel's sandbox SDK. Supports clone, exec, branch, commit.

**Trigger kinds:** `github.pull_request`, `github.pull_request_review`, `github.deployment_status`, `github.issue`, `schedule.cron`, `webhook.error`

**Current limitations relevant to loops:**
- No step sequencing — each background agent run is a single monolithic agent call
- No loop-back / cycle support — agents are one-shot per trigger
- No watchdog mechanism — failures go to `failed` state; no auto-recovery
- No UI for defining sequences — instructions are free-form markdown

### 2.2 Vercel Workflow DevKit (THE DURABLE EXECUTION PRIMITIVE)

Already installed as `workflow` v4.2.0-beta.72. This is how background agents are made durable.

Pattern for a multi-step durable workflow:
```ts
// apps/web/app/workflows/my-loop.ts
import { getWorkflowMetadata } from "workflow";

export async function runLoopWorkflow(input: { loopRunId: string }) {
  "use workflow";  // Marks this as durable
  const { workflowRunId } = getWorkflowMetadata();
  // Each await here is a durable checkpoint
  await executeLoopStep({ loopRunId: input.loopRunId, stepIndex: 0, workflowRunId });
}
```

The `"use workflow"` directive provides:
- Durability across crashes/restarts
- Correlation via `workflowRunId`
- Resume from last checkpoint

### 2.3 openAgent (THE AGENT RUNTIME)

`packages/agent/open-agent.ts` — a ToolLoopAgent (Anthropic AI SDK) with:
- Single step per call (`stopWhen: stepCountIs(1)`)
- Tools: file/bash/read/write/grep/glob/task (classic mode) or restricted set (managed_runtime mode)
- Sub-agents: explorer (read-only), executor (implements), design (UI)
- Skills loaded from sandbox `SKILL.md` frontmatter
- Streaming via async generator

**For the loop**: each loop step would call `openAgent` with a step-specific prompt and the loop's shared context (repo, branch, issue number, etc.).

### 2.4 Harness / Verified Build System (SEPARATE — low relevance for loops)

An external verified-build coordinator service. Separate SSE-based event system. Not relevant for loops unless loops need harness-level verification gates.

### 2.5 Workflow Catalog (STUB — not active)

`apps/web/lib/workflows/catalog.ts` — a registry of named workflows (verified-build, deep-research, etc.). All entries are `enabled: false` because "the managed workflow runtime has not shipped." This is separate from the Vercel `workflow` package; it's a metadata registry for a future UI. **The loop tool could register loops here eventually.**

---

## 3. What Needs to Be Built (Gaps)

### 3.1 Data Model (New Tables Needed)

The loop tool needs its own DB tables (none exist today):

**`agentLoops`** — loop definition (the graph):
- `id`, `userId`, `name`, `description`
- `repoOwner`, `repoName` (optional — loops can be repo-scoped)
- `nodes` JSONB — array of LoopNode definitions
- `edges` JSONB — array of LoopEdge definitions (from → to, condition)
- `status` enum[draft|active|paused|archived]
- `watchdogEnabled` boolean
- `watchdogInstructions` text (what the watchdog should do)

**`agentLoopRuns`** — one execution of the loop:
- `id`, `loopId`, `userId`
- `status` enum[running|paused|completed|failed|cancelled]
- `currentNodeId` text (which step is active)
- `iterationCount` integer (how many full cycles)
- `context` JSONB (shared state passed between steps)
- `workflowRunId` text (durable workflow correlation)
- `sandboxName` text
- `startedAt`, `finishedAt`

**`agentLoopStepRuns`** — one execution of a single node within a loop run:
- `id`, `loopRunId`, `nodeId`, `userId`
- `status` enum[queued|running|succeeded|failed|skipped]
- `stepInput` JSONB, `stepOutput` JSONB
- `errorKind`, `errorMessage`
- `startedAt`, `finishedAt`, `durationMs`
- `sandboxName`, `workflowRunId`

**`agentLoopEvents`** — immutable event log (mirrors background agent events pattern):
- `id`, `loopRunId`, `nodeId` nullable
- `eventName`, `status`, `level`, `summary`
- `payload` JSONB (redacted)

**`agentLoopWatchdogRuns`** — watchdog agent invocations:
- `id`, `loopRunId`
- `triggeredBy` text (nodeId that failed, or schedule)
- `status`, `diagnosis`, `actionTaken`
- `startedAt`, `finishedAt`

### 3.2 Node/Edge Type System

Each node in the loop graph needs a type:

```ts
type LoopNodeKind =
  | "trigger"          // Entry point (manual, cron, or external event)
  | "agent_step"       // Run openAgent with instructions
  | "github_check"     // Check GitHub (issues, PRs, status) — tool-call-only, no LLM
  | "condition"        // Branch on a condition (e.g. "are there open issues?")
  | "loop_back"        // Return to a previous node (creates the cycle)
  | "wait"             // Wait for human approval or external event
  | "end"              // Terminal node

type LoopNode = {
  id: string
  kind: LoopNodeKind
  label: string
  instructions?: string     // for agent_step
  toolPolicy?: "classic" | "managed_runtime"
  conditionExpression?: string  // for condition nodes
  waitConfig?: WaitConfig   // for wait nodes (timeout, approval)
  position: { x: number; y: number }  // React Flow position
}

type LoopEdge = {
  id: string
  source: string            // nodeId
  target: string            // nodeId
  condition?: "success" | "failure" | "always" | string  // custom condition
}
```

### 3.3 Visual Builder (React Flow — NOT YET INSTALLED)

**React Flow** (`@xyflow/react`) is the right library — it's the standard React node-graph library.

Install: `bun add @xyflow/react`

The loop builder UI needs:
- A canvas with draggable nodes (one per loop step)
- Edges connecting nodes with condition labels (success → green, failure → red)
- Node type-specific config panels (click a node to edit instructions)
- A sidebar with node type palette (drag to add)
- Toolbar: save, run, pause, delete
- Read-only "live view" mode showing current step highlighted during a run

**No React Flow exists in the codebase today.** This is a new dependency.

### 3.4 Durable Loop Executor (Workflow Function)

A new durable workflow that steps through the loop graph:

```ts
// apps/web/app/workflows/agent-loop.ts
import { getWorkflowMetadata } from "workflow";

export async function runAgentLoopWorkflow(input: { loopRunId: string }) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await executeAgentLoop({ loopRunId: input.loopRunId, workflowRunId });
}
```

The executor would:
1. Load loop definition and current run state
2. Find current node (or start node)
3. Execute the node (call openAgent for agent_step, call GitHub API for github_check, etc.)
4. Persist step result to `agentLoopStepRuns`
5. Evaluate outgoing edges to find next node
6. If `loop_back`: increment iteration count, jump to target
7. If `wait`: pause run, wait for external signal
8. Repeat until `end` or failure

**Each `await` in the durable workflow = a checkpoint.** If the server restarts, Vercel's workflow runtime resumes from the last checkpoint.

### 3.5 Watchdog Agent

A separate agent that runs alongside the loop (or is triggered on step failure):
- Has read-only access to loop run state, step logs, and error details
- Can call `repairLoopStep()` to re-run a failed step with modified context
- Can `pauseLoop()` and notify user if repeated failure
- Could be triggered: (a) on every step failure, (b) on N consecutive failures, (c) on a schedule while run is active

Implementation options:
- **Sidecar**: A separate durable workflow started alongside the loop run
- **Event-driven**: A background agent trigger that fires when `agentLoopStepRuns.status = 'failed'`
- **Polling**: The loop executor checks a watchdog after each failed step

### 3.6 API Routes Needed

```
POST   /api/agent-loops                        Create loop definition
GET    /api/agent-loops                        List user's loops
GET    /api/agent-loops/[loopId]               Get loop + nodes + edges
PATCH  /api/agent-loops/[loopId]               Update loop definition
DELETE /api/agent-loops/[loopId]               Delete loop

POST   /api/agent-loops/[loopId]/runs          Start a loop run
GET    /api/agent-loops/[loopId]/runs          List runs for loop
GET    /api/agent-loop-runs/[runId]            Get run detail + step runs + events
POST   /api/agent-loop-runs/[runId]/pause      Pause a running loop
POST   /api/agent-loop-runs/[runId]/resume     Resume a paused loop
POST   /api/agent-loop-runs/[runId]/cancel     Cancel a loop run
GET    /api/agent-loop-runs/[runId]/events     SSE stream of run events (for live view)

POST   /api/agent-loop-runs/[runId]/steps/[stepRunId]/approve  Approve a wait node
```

### 3.7 UI Pages Needed

```
/loops                           List all loops (cards with last run status)
/loops/new                       Create new loop (React Flow builder)
/loops/[loopId]                  Loop detail (builder + run history)
/loops/[loopId]/runs/[runId]     Live run view (React Flow read-only + step timeline)
```

---

## 4. Key Integration Points

### How Background Agents Connect to Loops

Option A: **Loops as a first-class system** (recommended)
- New `agentLoops*` tables, new executor, new API routes
- Loops reuse `connectSandbox` and `openAgent` from the background agent system
- Loops are triggered by the same trigger kinds (cron, GitHub events) OR manually

Option B: **Loops as an extension of background agents**
- Background agent gains a `loopDefinition` field
- Single background agent run steps through the loop
- Less clean; background agents were designed as one-shot

**Recommendation: Option A** — separate data model, shared execution primitives (sandbox, openAgent, workflow package).

### Sandbox Strategy for Loops

Each loop step could either:
1. **Share a sandbox** across steps in one run — persistent environment, faster, but requires careful state management
2. **Fresh sandbox per step** — clean isolation, matches current background agent behavior, but slower and loses in-progress repo state between steps

For a dev loop (check issue → implement → PR → confirm), **shared sandbox makes more sense** — the agent needs the repo checked out with the branch from the previous step.

### Shared Context Between Steps

Steps need to pass state (e.g. "issue #42 was claimed in step 1; step 2 should implement issue #42"). Options:
- **`agentLoopRuns.context` JSONB** — executor reads/writes shared state between steps
- **Files in sandbox** — previous step can write a context file that next step reads
- **Both**: structured JSON context in DB for deterministic routing; sandbox files for rich context

---

## 5. File/Package Locations (Where to Add New Code)

| What | Where |
|---|---|
| DB schema additions | `apps/web/lib/db/schema.ts` |
| Migration | `apps/web/lib/db/migrations/` |
| Loop store | `apps/web/lib/agent-loops/store.ts` |
| Loop executor | `apps/web/lib/agent-loops/executor.ts` |
| Loop dispatcher | `apps/web/lib/agent-loops/dispatcher.ts` |
| Loop types | `apps/web/lib/agent-loops/types.ts` |
| Durable workflow | `apps/web/app/workflows/agent-loop.ts` |
| API routes | `apps/web/app/api/agent-loops/` |
| React Flow builder | `apps/web/app/loops/[loopId]/loop-builder.tsx` |
| Live run view | `apps/web/app/loops/[loopId]/runs/[runId]/live-view.tsx` |
| Node type components | `apps/web/app/loops/nodes/` |
| Shared utilities | Reuse `apps/web/lib/background-agents/executor.ts` patterns |

---

## 6. Key Dependencies and Constraints

### Already Available
- `workflow` v4.2.0-beta.72 — durable workflow runtime (critical for loop durability)
- `@open-agents/sandbox` — sandbox connection and execution
- `packages/agent/open-agent.ts` — agent invocation
- `better-auth` — session management
- `drizzle-orm` — DB layer
- `zod` — validation

### Needs to Be Added
- `@xyflow/react` — React Flow for visual node builder (not installed)

### Constraints from CLAUDE.md
- Branch from `origin/develop`, PR into `develop`
- `bun run ci` must pass (oxlint + oxfmt + typecheck + tests)
- Migrations: `bun run --cwd apps/web db:generate` after schema changes; generated `.sql` must be idempotent (Neon preview DB issue)
- No `.js` extensions in imports, `unknown` not `any`, double quotes, 2-space indent
- Feature flag for new systems (`AGENT_LOOPS_ENABLED`)
- Redact sensitive data before persisting to event log

---

## 7. Architecture Summary (What to Tell the Planning Model)

```
User designs loop in React Flow builder
  → nodes: [trigger, agent_step, github_check, condition, loop_back, wait, end]
  → edges: [source, target, condition]
  → saved to: agentLoops (definition) + agentLoopNodes JSONB

User starts run → POST /api/agent-loops/[loopId]/runs
  → creates agentLoopRuns row
  → workflow/api.start(runAgentLoopWorkflow, [{ loopRunId }])
  → durable workflow begins

Loop executor (durable, checkpointed):
  while not at end node:
    load current node from agentLoopRuns.context
    execute node:
      agent_step → openAgent(step instructions + shared context)
      github_check → GitHub API call (tool-only, no LLM)
      condition → evaluate expression against context
      wait → pause run, emit SSE event for UI
    persist step result → agentLoopStepRuns
    update shared context → agentLoopRuns.context
    evaluate edges → find next node
    if loop_back → increment iteration, jump
    
  on step failure:
    if watchdog enabled → invoke watchdog agent
    watchdog reads: step logs, error, loop context
    watchdog decides: retry, skip, pause, or fix and retry
    
Live view: GET /api/agent-loop-runs/[runId]/events (SSE)
  → frontend React Flow shows current node highlighted
  → step timeline shows completed/running/failed steps
```

---

## 8. Open Questions for Planning

1. **Should loops share a sandbox or use fresh sandboxes per step?** Dev loops need shared state; QA loops might prefer isolation.
2. **Watchdog as sidecar vs event-triggered?** Sidecar is simpler; event-triggered is more modular and reuses background agent triggers.
3. **How does a loop "check GitHub for issues"?** Via openAgent with GitHub tools, or via a dedicated GitHub API tool-call node (no LLM, deterministic)?
4. **Approval/wait nodes**: Who approves? Same user? Slack notification? This drives the `wait` node design.
5. **Loop versioning**: If user edits a loop definition while a run is in-flight, does the run use the original or updated definition?
6. **Concurrency**: Can a loop have multiple runs in-flight simultaneously?
7. **React Flow license**: `@xyflow/react` is MIT for open-source projects; confirm this fits the open-agents license.
