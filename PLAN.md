# Runtime Agents Plan

## Goal

Make agent work visible in the chat transcript with a compact "Running N agents"
experience like the reference UI, and evolve managed runtimes so they can host
an actual working agent inside the runtime.

## GitHub Backlog

- Epic: [#656 Runtime agents for managed runtimes and transcript visibility](https://github.com/dennisonbertram/fork-open-agents/issues/656)
- [#657 Add runtime-agent read model and observability API](https://github.com/dennisonbertram/fork-open-agents/issues/657)
- [#658 Render runtime-agent summary cards in the transcript](https://github.com/dennisonbertram/fork-open-agents/issues/658)
- [#659 Record live runtime-agent lifecycle and activity events](https://github.com/dennisonbertram/fork-open-agents/issues/659)
- [#660 Drill from runtime-agent cards into runtime observability](https://github.com/dennisonbertram/fork-open-agents/issues/660)
- [#661 Add seeded runtime-agent regression and browser smoke harness](https://github.com/dennisonbertram/fork-open-agents/issues/661)
- [#662 Bridge runtime-agent cards to Verified Build workcells](https://github.com/dennisonbertram/fork-open-agents/issues/662)

The main product distinction should be:

- **Managed runtime**: the environment, sandbox, tools, profile, setup, and proof.
- **Runtime agent**: the actor doing a scoped job inside that environment.
- **Verified Build workcell**: the governed task contract that can later assign a
  runtime agent.

Do not rename managed runtimes into subagents. That would blur the important
boundary between "where work runs" and "who is doing the work."

## Existing Seams To Reuse

The codebase already has most of the persistence and proof structure:

- `delegated_worker_runs` in `apps/web/lib/db/schema.ts`
  - worker id/type/title/status
  - workspace mode and child workspace metadata
  - sandbox name
  - managed runtime profile id/version/run id
  - lifecycle events, completion packet, cleanup status, evidence refs
- `managed_runtime_profile_runs`
  - setup and verification observations for the runtime environment
- `session_events`
  - event-backed timeline with source, actor type, status, sandbox/profile refs
- `workflow_runs`
  - coordinator-level request/run attribution
- `apps/web/lib/db/delegated-worker-runs.ts`
  - records delegated worker runs from task tool output
- `apps/web/app/api/sessions/[sessionId]/observability/route.ts`
  - current read endpoint for runtime observability
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/runtime-observability-panel.tsx`
  - current detailed actor/runtime panel
- `apps/web/components/assistant-message-groups.tsx`
  - current transcript summary bar where "Used tools, ran agents" belongs
- Verified Build contracts:
  - `WorkcellContract.assigned_agent`
  - `WorkcellContract.delegated_worker`
  - `WorkerCompletionPacket`

Important gap: the current observability route still derives `workers` from
assistant message parts for managed runtime. The durable UI should read from
`delegated_worker_runs` first, with message extraction only as a compatibility
fallback. Also, worker rows are currently recorded post-finish, so live
"Running N agents" requires earlier lifecycle writes or live session events.

## Product Shape

### Transcript Summary

For assistant turns with workers, the existing collapsible summary should become
something like:

- Active: `Running 3 agents · 18s · 5 tools`
- Completed collapsed: `Used 7 tools, ran 6 agents`
- Expanded: a compact grid of runtime agent cards.

Each card should show:

- status dot
- short task title
- current activity pill, for example `Searching the web` or `Running tests`
- agent kind, for example `research`, `implementation`, `qa`
- runtime/profile hint only when useful, for example `web-bun-agent-browser`
- warning/proof state when the worker lacks completion evidence

The grid should live inline in the transcript, not inside a modal. Detailed
sandbox/runtime proof still belongs in the existing runtime activity panel.

### Detail Drill-In

Clicking a card should open the detailed runtime/sandbox panel filtered to that
agent where possible:

- worker lifecycle
- sandbox name
- managed runtime profile run
- setup/probe evidence
- tool calls and events
- completion packet
- cleanup state

This keeps the transcript scannable while preserving proof depth.

## Data Model

### First Pass: Read Model, No New Table

Add a small read-model layer:

- `apps/web/lib/runtime-agents/runtime-agent-read-model.ts`
- `apps/web/lib/runtime-agents/runtime-agent-read-model.test.ts`

It should convert existing rows into a UI DTO:

```ts
type RuntimeAgentCard = {
  id: string;
  workerRunId: string;
  taskTitle: string;
  agentKind: string;
  status: "queued" | "starting" | "running" | "blocked" | "completed" | "failed" | "cancelled" | "stale";
  activity: string;
  sandboxName: string | null;
  profileLabel: string | null;
  workspaceMode: "shared" | "isolated" | null;
  evidenceCount: number;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};
```

Source priority:

1. `delegated_worker_runs`
2. matching `session_events`
3. matching `managed_runtime_profile_runs`
4. current message-part extraction only as fallback for in-flight old messages

### Live Updates

To make active agent cards reliable, record worker lifecycle earlier than
post-finish:

- on task tool creation: write `planned` or `launching`
- when runtime setup starts: write `starting`
- when the worker begins executing: write `running`
- when current tool changes: emit a `session_event` with safe current activity
- on completion/error/approval block: update terminal status

Prefer event-backed state. The UI can poll the existing observability endpoint
every few seconds at first, then later switch to streaming/SSE if needed.

## API Changes

Extend `/api/sessions/[sessionId]/observability`:

- include `runtimeAgents`
- populate it from `listDelegatedWorkerRunsForSession`
- preserve existing `workers` field during migration
- include enough ids for deep-linking to the runtime panel

Potential shape:

```ts
type RuntimeAgentsObservability = {
  summary: {
    total: number;
    running: number;
    blocked: number;
    failed: number;
    completed: number;
  };
  agents: RuntimeAgentCard[];
};
```

## UI Implementation

Add colocated components rather than growing `session-chat-content.tsx`:

- `apps/web/components/runtime-agent-summary-grid.tsx`
- `apps/web/components/runtime-agent-card.tsx`
- `apps/web/components/runtime-agent-summary-grid.test.tsx`

Thread into:

- `apps/web/components/assistant-message-groups.tsx`
- `apps/web/components/tool-calls-summary-bar.tsx`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/runtime-observability-panel.tsx`

The transcript summary bar should support:

- agent count segment
- active agent activity segment
- expanded grid below the summary row
- no layout shift when collapsed
- compact mobile behavior with horizontal wrapping instead of overflow

## Verified Build Alignment

Do not make this depend on Verified Build yet. Verified Build docs say current
work is still in the contract phase, and UI/workcell orchestration is a later
step.

But design the DTO to map cleanly later:

- `RuntimeAgentCard.id` -> `WorkcellContract.assigned_agent.agent_id`
- `workerRunId` -> `WorkcellContract.delegated_worker.run_id`
- `taskTitle` -> `WorkcellContract.title`
- `status` -> workcell status
- `evidenceCount` -> evidence matrix count

When Verified Build workcells become active, the same grid can show governed
workcells instead of raw delegated workers.

## Rollout Plan

1. Create or identify the GitHub issue/epic for runtime-agent transcript
   visibility, linked to managed runtime and Verified Build plans.
2. Add the runtime-agent read model and tests against fixture rows/events.
3. Extend the observability route with `runtimeAgents` while keeping existing
   `workers` unchanged.
4. Add transcript UI for completed worker runs using persisted rows.
5. Add live lifecycle events/early upserts so active turns show "Running N
   agents" before the response finishes.
6. Add card click/drill-in wiring to the runtime observability panel.
7. Add Verified Build mapping only after the roadmap reaches real workcells.

## Regression Tests

Minimum durable coverage:

- read model maps `delegated_worker_runs` to cards with sandbox/profile proof
- read model prefers persisted worker rows over message extraction
- observability API returns `runtimeAgents` for owned sessions only
- completed assistant turn shows `ran N agents`
- active worker shows `Running N agents`
- expanded transcript shows card grid without requiring the runtime modal
- failed/blocked/stale worker cards render warning state
- long task titles truncate without expanding the chat layout
- runtime panel can filter/open from a card id

Browser QA:

- run local app on `localhost:3002`
- open a managed-runtime chat with seeded worker fixtures
- verify collapsed summary, expanded grid, card hover, and drill-in
- check console and server logs

Required final checks:

- focused tests first
- `git diff --check`
- `bun --bun run ci`

## Non-Goals For First PR

- no large-scale autonomous swarm
- no direct worker-to-worker chat
- no new generalized workflow product surface
- no claim that worker self-checks are final proof
- no replacement of the existing runtime/sandbox activity panel

## Open Decisions

- Product label: `Runtime agents`, `Workers`, or `Subagents`.
- Should completed grids stay expandable forever, or collapse into a one-line
  "Used tools, ran agents" record after the run is old?
- Should classic `task` subagents appear in the same grid, or only managed
  runtime workers?
- Should active updates be polling-only for V1, or should we add a session event
  stream while touching this area?
