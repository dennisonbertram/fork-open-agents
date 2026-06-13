# Agent Loops — Authenticated Smoke Checklist

Use this checklist to run the full authenticated loops smoke. It covers the
complete operator journey: create → configure in the builder → activate → run
→ watch live → see a failure → retry. Every stage lists the exact click path
or command, the expected HTTP status or UI state, and the evidence to capture.

This checklist is the proof template for closing issues #331 and #332 and is
the skeleton the M3-03 watchdog live-proof (#336) extends. Running stages S-9
and S-10 IS the browser-smoke evidence issue #331 is waiting on — post the
captured screenshots and console output as a comment on #331 after completing
those stages.

Related epic: #319.  
Closed by: #333.

---

## Prerequisites

Complete these steps before opening the browser. Do not mark any stage
complete if the local environment cannot load the database-backed pages.

**1. Environment variables**

Confirm `apps/web/.env.local` contains non-empty values for each of the
following without printing their values:

```bash
grep -c 'POSTGRES_URL\|BETTER_AUTH_SECRET\|AGENT_LOOPS_ENABLED\|AGENT_LOOPS_ALLOWED_REPOS' \
  apps/web/.env.local
# Expected: 4 (all four keys present)
```

Required vars:
- `POSTGRES_URL` — local development database (Neon dev branch or local
  Postgres). Never point at production.
- `BETTER_AUTH_SECRET` — session signing key.
- `AGENT_LOOPS_ENABLED=true` — feature flag. The loops surface returns 403 to
  every API call when this is absent or set to anything other than `true`.
- `AGENT_LOOPS_ALLOWED_REPOS` — comma-separated `owner/repo` allowlist (for
  example `myorg/test-repo`). Set to `*` to allow every repo during smoke.
  The test repo must have the GitHub App installed for agent_step runs to work;
  for stages that only exercise the API and builder, any value passes.

Optional but recommended:
- `PORT=3001` (or another free port) when `localhost:3000` is occupied by
  another app.

**2. Migrate the local database**

```bash
bun run --cwd apps/web db:migrate:apply
```

This applies any pending Drizzle migrations to the development database. Re-run
whenever `apps/web/lib/db/schema.ts` changes.

**3. Start the app**

```bash
PORT=3001 bun run web
# or, when 3000 is free:
bun run web
```

Verify it is running before opening the browser:

```bash
curl -sI http://localhost:3001/api/auth/info | head -1
# Expected: HTTP/1.1 200 OK
```

**4. Set the test-auth session cookie**

In a development shell, bypass OAuth sign-in by injecting the test-auth cookie
so `agent-browser` commands run as an authenticated user:

```bash
agent-browser --session loops-smoke cookies set open_agents_test_user_id \
  dev-managed-runtime-user \
  --url http://localhost:3001 \
  --path / \
  --sameSite Lax
```

After setting the cookie, take an initial snapshot to confirm the app loaded
and the user is authenticated:

```bash
agent-browser --session loops-smoke snapshot -i http://localhost:3001
```

Expected: the page renders (no auth-wall redirect), the nav shows a signed-in
state.

---

## Stages

### S-1 — Create a loop

**Purpose:** Verify the loops list page renders and the POST /api/agent-loops
endpoint accepts a well-formed definition.

**UI path:**

1. Navigate to `http://localhost:3001/loops/new`.
2. Fill in:
   - Name: `Smoke loop`
   - Description: `M2-04 smoke run`
   - Repository owner and name matching an `AGENT_LOOPS_ALLOWED_REPOS` entry.
3. Submit the form.
4. Confirm redirect to `/loops/<loopId>` (the loop detail page).

**API equivalent** (curl, optional cross-check):

```bash
curl -s -X POST http://localhost:3001/api/agent-loops \
  -H "Content-Type: application/json" \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  -d '{
    "name": "Smoke loop",
    "repoOwner": "<owner>",
    "repoName": "<repo>",
    "definition": {
      "nodes": [
        {"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0}},
        {"id":"end","kind":"end","label":"End","position":{"x":200,"y":0}}
      ],
      "edges": [{"id":"e1","source":"start","target":"end","when":"always"}]
    }
  }'
# Expected: 201 Created, body contains loopId
```

**Evidence to capture:**
- `loopId` from the URL or response body.
- Screenshot of the loop detail page after redirect.

---

### S-2 — GET round-trip semantic stability

**Purpose:** Confirm the definition returned by GET is semantically equal to
the definition sent in S-1. Note: the definition is stored as Postgres `jsonb`,
which normalises key order on write (for example, the GET response may return
`edges` before `nodes` and reorder fields within node objects). Do not assert
byte-identical JSON or a specific key order; instead compare semantically with
`jq -S` (which sorts keys before diffing).

```bash
LOOP_ID=<loopId from S-1>
# Capture what was sent (paste the definition from S-1 into /tmp/sent.json first)
cat /tmp/sent.json | jq -S . > /tmp/sent-sorted.json

curl -s http://localhost:3001/api/agent-loops/$LOOP_ID \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  | jq -S '.loop.definition' > /tmp/got-sorted.json

diff /tmp/sent-sorted.json /tmp/got-sorted.json
# Expected: no diff (semantic equality; key order may differ)
```

**Evidence to capture:** The `diff` output (empty = pass) confirming the
definition is semantically present and well-formed.

---

### S-3 — PATCH a valid definition

**Purpose:** Verify the PATCH endpoint accepts a definition update and that
the GET round-trip still holds after the update.

```bash
LOOP_ID=<loopId>
curl -s -X PATCH http://localhost:3001/api/agent-loops/$LOOP_ID \
  -H "Content-Type: application/json" \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  -d '{
    "definition": {
      "nodes": [
        {"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0}},
        {"id":"step1","kind":"agent_step","label":"Do work","position":{"x":200,"y":0},
         "instructions":"Run the test suite.","checkCommand":"bun test"},
        {"id":"end","kind":"end","label":"End","position":{"x":400,"y":0}}
      ],
      "edges": [
        {"id":"e1","source":"start","target":"step1","when":"always"},
        {"id":"e2","source":"step1","target":"end","when":"success"}
      ]
    }
  }'
# Expected: 200 OK
```

Then re-run the GET from S-2 and confirm the definition reflects the update.

**Evidence to capture:** HTTP 200 status, updated definition in the GET
response.

---

### S-4 — PATCH invalid definition rejected with 400 loop_invalid

**Purpose:** Confirm the server validates definitions on write and rejects
structurally invalid graphs with a typed `loop_invalid` error.

Example: a definition with no `end` node violates VR-02 (`no_end`):

```bash
LOOP_ID=<loopId>
curl -s -X PATCH http://localhost:3001/api/agent-loops/$LOOP_ID \
  -H "Content-Type: application/json" \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  -d '{
    "definition": {
      "nodes": [
        {"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0}}
      ],
      "edges": []
    }
  }'
```

**Expected:** HTTP 400. Body contains `"errorKind":"loop_invalid"` and an
`errors` array that includes a `no_end` entry.

**Evidence to capture:** Full response body showing the `no_end` error.

---

### S-5 — Activate the loop

**Purpose:** Move the loop from `draft` to `active` status so it can accept
runs.

**UI path:**

1. On the loop detail page (`/loops/<loopId>`), find the status control.
2. Change status from `draft` to `active` (the status Select shows Draft/Active/Paused/Archived).
3. Confirm the page reflects `active` status.

**API equivalent:**

```bash
LOOP_ID=<loopId>
curl -s -X PATCH http://localhost:3001/api/agent-loops/$LOOP_ID \
  -H "Content-Type: application/json" \
  -b "open_agents_test_user_id=dev-managed-runtime-user" \
  -d '{"status":"active"}'
# Expected: 200 OK
```

**Evidence to capture:** Status field shows `active` in the UI or GET response.

---

### S-6 — Start a run; second start returns 409 with activeRunId

**Purpose:** Verify the run dispatch endpoint creates a run record and blocks
duplicate starts.

**Start the run:**

```bash
LOOP_ID=<loopId>
curl -s -X POST http://localhost:3001/api/agent-loops/$LOOP_ID/runs \
  -b "open_agents_test_user_id=dev-managed-runtime-user"
# Expected: 202 Accepted, body contains runId and created: true
```

Record the `runId` from the response.

**Attempt a second start:**

```bash
curl -s -X POST http://localhost:3001/api/agent-loops/$LOOP_ID/runs \
  -b "open_agents_test_user_id=dev-managed-runtime-user"
```

**Expected:** HTTP 409. Body contains `"errorKind":"active_run"` and an
`activeRunId` matching the `runId` from the first start.

**Evidence to capture:** 202 body with `runId`, 409 body with `activeRunId`.

---

### S-7 — Run list

**Purpose:** Confirm the run appears in the loop's run list.

```bash
LOOP_ID=<loopId>
curl -s http://localhost:3001/api/agent-loops/$LOOP_ID/runs \
  -b "open_agents_test_user_id=dev-managed-runtime-user" | jq '.runs | length'
# Expected: 1 (or more if S-6 was re-run)
```

**UI path:** Navigate to `/loops/<loopId>` and confirm the run appears in the
runs list with its status and timestamp.

**Evidence to capture:** Run count from the API, screenshot of the runs list.

---

### S-8 — Run events

**Purpose:** Confirm the event stream for the run is accessible.

```bash
RUN_ID=<runId from S-6>
curl -s http://localhost:3001/api/agent-loop-runs/$RUN_ID \
  -b "open_agents_test_user_id=dev-managed-runtime-user" | jq '.run.status, (.events | length)'
```

**Expected:** Run status (`queued`, `running`, `completed`, or `failed`) and an
events array that eventually includes an `agent-loop.run.started` entry (immediately
after the 202, only `agent-loop.trigger.received`, `agent-loop.run.created`, and
`agent-loop.chain.dispatched` may be present; `agent-loop.run.started` is emitted
by the chain executor when the run actually begins).

Note: the run status enum is `queued | running | paused | completed | failed |
cancelled | stalled`. There is no `succeeded` status at the run level —
`succeeded` appears only at the step/event level. A healthy fast-path run
finishes as `completed`.

**Evidence to capture:** Run status and event count.

---

### S-9 — Builder canvas

**Purpose:** Exercise the visual builder canvas — add a node, connect an edge,
save, and confirm the round-trip.

**UI path:**

1. Navigate to `/loops/<loopId>/builder`.
2. Confirm the canvas renders the current definition (the three-node graph from
   S-3: start → agent_step → end).
3. From the node palette (left sidebar), **click** the `github_check` entry to
   add it to the canvas. The palette is click-to-add, not drag-and-drop.
4. Connect a `when`-labeled edge from the `agent_step` node to the new
   `github_check` node. Select `failure` as the `when` value.
5. Connect a `when`-labeled edge from the `github_check` node to the `end`
   node. Select `success` as the `when` value. This is required: every node
   must have at least one outgoing edge (VR-04) or the client validation will
   report an error and disable the Save button.
6. Click Save.
7. Navigate away and return to the builder. Confirm the new node and edges are
   present.

```bash
agent-browser --session loops-smoke snapshot -i http://localhost:3001/loops/<loopId>/builder
```

**Expected:** Canvas shows all four nodes with the new edge. Save does not
produce an error toast.

**NOTE:** Completing this stage and S-10 IS the browser-smoke evidence that
issue #331 is waiting on. After completing S-9 and S-10, post the screenshots
and console output as a comment on issue #331.

**Evidence to capture:**
- `agent-browser --session loops-smoke snapshot -i` output showing the canvas
  with the new node.
- No errors in `agent-browser --session loops-smoke errors`.
- Screenshot showing the connected `failure` edge.

---

### S-10 — Builder config panels

**Purpose:** Exercise every config panel type in the builder.

Work through each panel type in order:

**10a — Node config panel: agent_step**

1. Click the `agent_step` node.
2. In the side panel, edit the Instructions field (add a sentence).
3. Edit the Check Command field (`bun test`).
4. Confirm no validation error badge appears.
5. Save.

**10b — Node config panel: github_check**

1. Click the `github_check` node added in S-9.
2. Select check kind `pr_status` from the dropdown.
3. Fill in `prNumberFrom` with `context.pr_number`.
4. Confirm no validation error badge appears.
5. Save.

**10c — Edge `when` editing**

1. Click the edge between `agent_step` and `github_check`.
2. Change the `when` value from `failure` to `always`. (Do not use `success` here:
   `agent_step` already has a `success` edge to `end` from S-3/S-9, so choosing
   `success` would create a duplicate `(source, when)` pair, trigger VR-07
   `duplicate_when`, and leave the Save button disabled.)
3. Confirm the edge label updates on the canvas.
4. Save.
5. Change the edge back to `failure` so subsequent stages use a consistent graph.

**10d — Delete-node dialog with edge count**

1. Click a node that has at least one connected edge.
2. Click Delete (or the delete affordance).
3. Confirm the dialog appears and names the number of edges that will be
   removed alongside the node.
4. Cancel (do not actually delete during smoke; or use a throwaway node added
   only for this step).

**10e — Loop settings panel**

1. Open the loop settings panel (gear icon or Settings tab in the builder).
2. Edit the loop Name and Description.
3. Adjust a guardrail (for example Max Steps — must stay at or below the
   server ceiling of 200; default is 50).
4. Save.
5. Confirm the loop detail page reflects the updated name.

**NOTE:** Completing S-9 and S-10 IS the browser-smoke evidence issue #331 is
waiting on. Post screenshots and console output to #331 after this stage.

**Evidence to capture:**
- Screenshot of each panel type.
- `agent-browser --session loops-smoke errors` and
  `agent-browser --session loops-smoke console` output (see S-13 for expected
  pre-existing warnings).
- GET response confirming the updated definition round-trips.

---

### S-11 — Run-detail live graph

**Purpose:** Verify the live run-detail page renders the graph correctly while
a run is in progress or after it completes.

**UI path:**

1. Navigate to `/loops/<loopId>/runs/<runId>`.
2. While the run is in progress (status `running`), observe:
   - The current node pulses (active node indicator).
   - Completed nodes are colored `succeeded` (green) or `failed` (red).
   - Nodes visited more than once show a `×N` visit pill.
   - The latest transition edge is dashed.
   - The iteration meter shows the current iteration count.
   - The page polls for updates automatically.
3. After the run reaches a terminal status (`completed`, `failed`, `cancelled`,
   or `stalled`):
   - Polling stops (no further network requests to the events endpoint).
   - The terminal node state is reflected in the graph.

Note: the run status enum is `queued | running | paused | completed | failed |
cancelled | stalled`. `succeeded` exists only at the step/event level; terminal
run statuses are `completed`, `failed`, `cancelled`, and `stalled`.

```bash
agent-browser --session loops-smoke snapshot -i \
  http://localhost:3001/loops/<loopId>/runs/<runId>
```

**Evidence to capture:** Screenshot of the run-detail graph showing at least
one non-initial state (a colored node or a dashed edge).

---

### S-12 — Retry stage

**Purpose:** Exercise the retry flow: seed a loop whose step deterministically
fails, observe the failure, trigger a retry, and confirm a new attempt appears.

**12a — Create a failing loop**

Use the following definition, which includes a `github_check` `pr_status` node
with `prNumberFrom` set to the literal string `"99999"`. Because `prNumberFrom`
is treated as a **context path** (resolved via `lookupContextPath` before any
GitHub API call), and the run's context object has no key `"99999"`, the
executor fails immediately with `errorKind: condition_path_missing` ("Context
path '99999' not found"). No GitHub App or network call is needed — the failure
is purely local. The loop also has no `failure` edge on `gh-check`, so the run
transitions to `failed` deterministically (chain.ts: failed step + no failure
edge → run failed).

```json
{
  "nodes": [
    {"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0}},
    {
      "id":"gh-check",
      "kind":"github_check",
      "label":"Check PR #99999",
      "position":{"x":200,"y":0},
      "check":{"kind":"pr_status","prNumberFrom":"99999"}
    },
    {"id":"end","kind":"end","label":"End","position":{"x":400,"y":0}}
  ],
  "edges":[
    {"id":"e1","source":"start","target":"gh-check","when":"always"},
    {"id":"e2","source":"gh-check","target":"end","when":"success"}
  ]
}
```

Create a new loop (`POST /api/agent-loops`) with this definition and `status`
set to `"active"`, targeting a repo in `AGENT_LOOPS_ALLOWED_REPOS`. Record the
new `loopId`.

**12b — Start a run and observe failure**

```bash
FAILING_LOOP_ID=<loopId from 12a>
curl -s -X POST http://localhost:3001/api/agent-loops/$FAILING_LOOP_ID/runs \
  -b "open_agents_test_user_id=dev-managed-runtime-user"
# Expected: 202 Accepted, body contains runId
```

Navigate to `/loops/<loopId>/runs/<runId>` and wait for the run to reach
`failed` status. The `gh-check` node should be colored red. The timeline should
show a `condition_path_missing` failure event — the step failed because the
context path `"99999"` does not exist in the run's context object, not because
of a GitHub API response. No GitHub App installation is required for this stage.

**12c — Retry via the run-page button**

1. On the run-detail page, find the Retry button.
2. Click Retry.
3. Confirm the **same run** transitions: the run status changes from `failed`
   to `running` (or `queued`) and the timeline gains two new events:
   `agent-loop.run.retry` and `agent-loop.chain.dispatched`. The run list at
   `/loops/<loopId>` still shows **one run** — retry does **not** create a new
   run record. The retried step is attempt n+1 of the same current node, picked
   up from the failed node (not from the beginning of the graph).

**API equivalent for the retry:**

```bash
RUN_ID=<original failed runId>
curl -s -X POST http://localhost:3001/api/agent-loop-runs/$RUN_ID/retry \
  -b "open_agents_test_user_id=dev-managed-runtime-user"
# Expected: 200 OK, body: {"success":true}
```

**12d — Confirm the retry attempt in the timeline**

Stay on the same run's detail page (same `runId` — no navigation needed).
Confirm:
- The run status changed from `failed` to `running` or `queued`.
- The timeline shows `agent-loop.run.retry` followed by
  `agent-loop.chain.dispatched` as the two newest events.
- The step attempt counter for `gh-check` increments (attempt n+1 of the same
  node in the same run).
- Because `prNumberFrom: "99999"` still resolves to `condition_path_missing`,
  the retried step fails again with the same error — this is expected and
  confirms the retry path is exercised correctly.

**Evidence to capture:**
- Screenshot of the failed run showing the red `gh-check` node.
- HTTP 200 response from the retry endpoint.
- Screenshot of the run timeline showing `agent-loop.run.retry` and
  `agent-loop.chain.dispatched` events.
- Confirmation that the run list at `/loops/<loopId>` still shows exactly one
  run (same `runId`).

---

### S-13 — Hygiene sweep

**Purpose:** Confirm no unexpected console errors or server log failures after
running the full smoke. Document all pre-existing warnings.

**Console and browser errors:**

```bash
agent-browser --session loops-smoke errors
agent-browser --session loops-smoke console
```

**Known pre-existing warnings** (accepted findings — do not re-triage; tracked
under the UX backlog epic #373):

1. **React Flow `nodeTypes`/`edgeTypes` identity warning** — React Flow emits a
   warning when `nodeTypes` or `edgeTypes` object references change between
   renders. This is a known stability issue in the builder canvas and is tracked
   under #373.
2. **Dark/light hydration class mismatch** — The theme class (`dark`/`light`)
   on the `<html>` element may differ between server render and client hydration
   depending on the system theme. This produces a React hydration warning in
   development mode and is tracked under #373.

Any other console errors or `agent-browser errors` entries are new findings and
must be filed as issues before the smoke can be marked complete.

**Dev-server logs:**

Inspect the terminal running `bun run web` after completing all stages. Confirm
there are no unexpected 500-level errors, unhandled promise rejections, or
database errors outside the pre-existing known set.

**Evidence to capture:**
- Full `agent-browser errors` and `agent-browser console` output, annotated to
  mark which entries match the two accepted warnings above.
- Note in the PR or issue comment that the dev-server log was inspected and the
  result (clean or flagged).

---

## Posting Evidence

After completing all stages:

1. **Issue #331** (builder panels): Post `agent-browser` console/error output
   and screenshots from S-9 and S-10 as a comment on #331. This is the
   browser-smoke evidence that closes the panel smoke gate.

2. **Issue #332** (run-detail live graph): Post the S-11 screenshot showing
   live node states as a comment on #332.

3. **Issue #333** (M2-04 closeout): Post a summary comment confirming all 13
   stages completed, attaching the S-12 retry evidence. Closes #333.

4. **M3-03 live-proof (#336)**: The watchdog live-proof issue extends this
   checklist. Begin there after #333 is closed. The S-12 retry stage is the
   baseline the watchdog proof builds on.
