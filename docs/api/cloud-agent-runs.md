# Cloud Agent Runs API

The Cloud Agent Runs API lets a machine client start and inspect Open Agents
cloud sandbox work without depending on browser chat routes or UI stream
chunks.

## Authentication

Create an API key from **Settings -> API keys**. The raw `oa_...` key is shown
once. Store it as a secret and send it as a bearer token:

```bash
curl -H "Authorization: Bearer $OPEN_AGENTS_API_KEY" \
  http://localhost:3000/api/v1/agent-runs
```

Keys are scoped with `agent_runs:create`, `agent_runs:read`, and
`agent_runs:cancel`. A key can optionally be restricted to repository
allowlist entries such as `owner/repo`.

## Create A Run

`POST /api/v1/agent-runs`

```bash
curl -X POST http://localhost:3000/api/v1/agent-runs \
  -H "Authorization: Bearer $OPEN_AGENTS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: local-run-001" \
  -d '{
    "prompt": "Run the tests and summarize the result.",
    "title": "Test run",
    "repository": {
      "owner": "dennisonbertram",
      "name": "fork-open-agents",
      "newBranch": true
    },
    "runtimeMode": "managed_runtime",
    "metadata": { "client": "local-cli" }
  }'
```

`202 Accepted` means a workflow was started. Reusing the same idempotency key
with the same API key returns the existing run with `200 OK` and
`idempotentReplay: true`.

## Read Status

`GET /api/v1/agent-runs/:runId`

The response includes stable run ids, session/chat/workflow ids, runtime and
sandbox attribution, latest assistant output summary, failure details, and
links to the related API resources.

## Events

`GET /api/v1/agent-runs/:runId/events?after=<eventId>&limit=100`

Events are redacted session events scoped to the run. With `after`, events are
returned oldest-first so CLI clients can append progress naturally. Without
`after`, the newest events are returned first.

## Messages

`GET /api/v1/agent-runs/:runId/messages`

Messages default to API-friendly `text`, `metadata`, and `outputs` summaries.
Raw UI message parts are omitted unless `include=ui_parts` is supplied.

## Cancel

`POST /api/v1/agent-runs/:runId/cancel`

Cancellation calls the Workflow SDK and clears the chat active stream only when
it still matches this run's workflow id.

## Proof

`GET /api/v1/agent-runs/:runId/proof`

The proof bundle contains stable checks:

- `workflow_started`
- `workflow_terminal`
- `workflow_run_row`
- `sandbox_attributed`
- `managed_runtime_profile_ready`
- `assistant_message_persisted`
- `runtime_proof_persisted`
- `redaction_passed`

The proof status is `passed`, `blocked`, or `failed`. Missing required evidence
fails closed as `blocked` or `failed`.

## Programmatic Checks

```bash
bun run --cwd apps/web scripts/agent-api-smoke.ts -- \
  --base-url http://localhost:3000 \
  --api-key-env OPEN_AGENTS_API_KEY \
  --repo dennisonbertram/fork-open-agents \
  --runtime-mode managed_runtime \
  --expect-terminal completed
```

```bash
bun run --cwd apps/web scripts/agent-api-proof-check.ts -- \
  --base-url http://localhost:3000 \
  --api-key-env OPEN_AGENTS_API_KEY \
  --run-id arun_... \
  --expect-proof passed
```

## Security Notes

The API stores token hashes only. Responses never include raw token values after
creation, token hashes, bearer headers, cookies, provider tokens, installation
tokens, raw prompts in events, or full runtime logs. Repository allowlist denial
happens before session, sandbox, or GitHub installation-token work begins.
