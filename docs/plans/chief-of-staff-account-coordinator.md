# Chief of Staff Account Coordinator

Prepared: 2026-06-20

GitHub epic: https://github.com/dennisonbertram/fork-open-agents/issues/559

Initial backend PR:
https://github.com/dennisonbertram/fork-open-agents/pull/568

## Goal

The Chief of Staff account coordinator is a read-only backend surface for
answering, "What is happening across my account, and why does this work item
need attention?"

It is intentionally backend-first. There is no dedicated frontend or chat tool
yet. Until those exist, operators and agents should interact with it through the
authenticated account API routes documented below.

## Current Backend Surface

Status snapshot:

```text
GET /api/account/status?window=24h
```

Deep diagnosis:

```text
GET /api/account/diagnosis?source=session&id=<id>&limit=80
GET /api/account/diagnosis?source=chat_workflow&id=<workflowRunId>&limit=80
GET /api/account/diagnosis?source=background_agent&id=<runId>&limit=80
GET /api/account/diagnosis?source=agent_loop&id=<runId>&limit=80
```

`window` accepts bounded hour windows such as `24h` or `168h`. Diagnosis
`limit` is bounded by the backend and defaults to a safe evidence window.

The status response includes `diagnosisHref` on work items so a future Chief of
Staff UI or tool can drill into diagnosis without guessing source-specific
routes.

## What The Status Route Answers

`GET /api/account/status` returns an authenticated, user-scoped account work
snapshot with these sections:

- `needsAttention`
- `running`
- `recentlyCompleted`
- `waitingOnUser`
- `stale`
- `scheduledAgents`
- `sourceStatus`

Each work item includes normalized status, attention reasons, optional repo
context, optional output href, redacted metadata, and `diagnosisHref`.

The current source windows are:

- sessions;
- chat workflow runs;
- background agent runs;
- agent loop runs;
- scheduled agents.

Partial source failures are surfaced in `sourceStatus` instead of failing the
whole snapshot.

## What The Diagnosis Route Answers

`GET /api/account/diagnosis` returns a bounded evidence bundle for one selected
target. A Chief of Staff agent should use this route after picking a work item
from the account status snapshot.

The response includes:

- `target` - the normalized work item being diagnosed;
- `project` - repo, branch, PR, or issue context when known;
- `diagnosis` - normalized status, attention reasons, summary, evidence counts,
  and `sourceGaps`;
- `sourceStatus` - per-source success, partial, or failed state;
- `diagnosis.sourceGaps` - unavailable evidence windows, such as missing tables
  or missing GitHub connection;
- `correlations` - session IDs, chat IDs, workflow run IDs, request IDs,
  harness run IDs, sandbox/service/browser IDs, PR numbers, and issue numbers;
- `timeline` - chronological evidence for scan-friendly diagnosis;
- `evidence` - the bounded raw evidence records after redaction.

Supported diagnosis targets:

- `session`
- `chat_workflow`
- `background_agent`
- `agent_loop`

## Evidence Sources

Depending on target type and available correlations, diagnosis can include:

- target metadata;
- workflow runs;
- workflow run steps;
- workflow input snapshots;
- session events;
- managed runtime profile runs;
- sandbox service records;
- sandbox browser runs;
- workflow goals and goal events;
- Verified Build runs and events;
- background agent events;
- background agent outputs;
- background agent tool sessions;
- agent loop step runs;
- agent loop events;
- agent loop watchdog runs;
- scoped GitHub repository dashboard evidence for PRs, issues, and Actions.

GitHub project evidence is only loaded when the target has repo context and the
authenticated user has a usable GitHub connection for that repo. If GitHub is
not connected or the app cannot read one window, the diagnosis reports a
`github_*` source gap rather than leaking data from another user or failing the
whole diagnosis.

## Scope And Trust Boundary

The API is authenticated and owner-scoped. Every route starts from the current
user and only returns work items or evidence owned by that user. Missing or
non-owned diagnosis targets return `404`.

The API is read-only. It does not propose actions, mutate GitHub, start agents,
cancel work, rerun checks, or write database records.

Redaction is part of the contract:

- nested diagnostic JSON is recursively bounded;
- secret-like keys and token-like values are redacted;
- raw logs, prompt-like content, stdout/stderr, and authorization headers are
  not exposed as raw strings;
- source failures are reported as typed gaps/statuses, not raw exception dumps.

## Local API Smoke

Use the main project env when testing this worktree locally:

```bash
set -a
source /Users/dennison/develop/open-agents/apps/web/.env.local
set +a
PORT=3001 bun run web
```

In development, the test auth cookie can be used for the seeded managed runtime
demo user:

```bash
curl -sS \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  "http://localhost:3001/api/account/status?window=168h" | jq
```

Drill into a returned item:

```bash
curl -sS \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  "http://localhost:3001/api/account/diagnosis?source=session&id=managed-runtime-demo-session&limit=25" | jq
```

A repo-backed local loop can prove project scoping:

```bash
curl -sS \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  "http://localhost:3001/api/account/diagnosis?source=agent_loop&id=Z7_vgpi2aacncEu2YLRO1&limit=25" \
  | jq '{source,id,status:.diagnosis.status,project,githubStatus:(.sourceStatus[]? | select(.source=="github_repo_dashboard")),sourceGaps:.diagnosis.sourceGaps}'
```

Known local caveats:

- the seeded dev auth user may not have a GitHub OAuth connection, so GitHub
  windows can appear as `github_not_connected` source gaps;
- older local databases may be missing newer observability tables such as
  `workflow_input_snapshots`, which should appear as a source gap rather than a
  route failure.

## How A Future Frontend Should Use It

1. Fetch `/api/account/status?window=24h` for the account overview.
2. Render `needsAttention` first, then running/stale/waiting/completed sections.
3. Use each item's `diagnosisHref` to fetch evidence on demand.
4. Treat `sourceStatus` and `sourceGaps` as first-class UI states. Missing
   evidence is different from confirmed healthy evidence.
5. Render `diagnosis.summary`, then correlations and timeline.
6. Never infer that a source is healthy just because a section is empty. Use the
   source status.

## How A Future Chief of Staff Tool Should Use It

An agent/tool should:

1. call status first;
2. pick items with `needsAttention=true`, failed/stale/running-too-long status,
   or source failures;
3. call the selected item's `diagnosisHref`;
4. cite `sourceStatus`, `sourceGaps`, correlations, and timeline evidence in its
   answer;
5. clearly distinguish confirmed evidence from unavailable sources;
6. avoid recommending mutation unless a separate, explicitly authorized action
   tool exists.

Good operator answer shape:

```text
Work item: <title>
Current state: <status and attention reasons>
Most relevant evidence: <timeline/evidence highlights>
Project context: <repo/branch/PR/issue if present>
Missing evidence: <source gaps, if any>
Suggested next check: <read-only next diagnostic step>
```

## Implementation Pointers

Routes:

- `apps/web/app/api/account/status/route.ts`
- `apps/web/app/api/account/diagnosis/route.ts`

Coordinator modules:

- `apps/web/lib/account-coordinator/snapshot.ts`
- `apps/web/lib/account-coordinator/diagnosis.ts`
- `apps/web/lib/account-coordinator/diagnosis-store.ts`
- `apps/web/lib/account-coordinator/redaction.ts`
- `apps/web/lib/account-coordinator/taxonomy.ts`
- `apps/web/lib/account-coordinator/types.ts`

Relevant tests:

- `apps/web/app/api/account/status/route.test.ts`
- `apps/web/app/api/account/diagnosis/route.test.ts`
- `apps/web/lib/account-coordinator/*.test.ts`

## Verification Baseline

For backend-only edits to this surface, run:

```bash
bun test apps/web/lib/account-coordinator/*.test.ts apps/web/app/api/account/status/route.test.ts apps/web/app/api/account/diagnosis/route.test.ts
bun --bun run ci
git diff --check
```

For behavioral confidence, also run the local curl smoke above with
`apps/web/.env.local` or the main project `.env.local` sourced.
