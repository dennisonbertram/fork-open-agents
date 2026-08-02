# API contract: core journeys

Observed by running `scripts/api-exercise/journeys-core.ts` against a local server.

## J-AUTH-01: Session identity and unauthenticated boundary

Result: **PASS** (4 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ anonymous caller gets an empty identity, not an error | `GET /api/auth/info` | 200 | — |
| 2 | ✓ anonymous caller cannot list sessions | `GET /api/sessions` | 401 | error |
| 3 | ✓ authenticated caller is identified | `GET /api/auth/info` | 200 | authProvider, hasGitHub, hasGitHubAccount, hasGitHubInstallations, isAdmin, user |
| 4 | ✓ authenticated caller can list sessions | `GET /api/sessions` | 200 | sessions |

## J-PREFS-01: Read, update and re-read account preferences

Result: **FAIL** (3 passed, 1 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ read current preferences | `GET /api/settings/preferences` | 200 | preferences |
| 2 | ✗ reject an unknown preference value | `PATCH /api/settings/preferences` | 200 | preferences |
| 3 | ✓ set a valid preference | `PATCH /api/settings/preferences` | 200 | preferences |
| 4 | ✓ preference survives a re-read | `GET /api/settings/preferences` | 200 | preferences |

### Failures

- **reject an unknown preference value** — `PATCH /api/settings/preferences` returned 200 (expected one of 400/422)
  ```
  {"preferences":{"defaultModelId":"user-profile:NCFsMdcF0NkYyxY4BJfib:local-pro","defaultSubagentModelId":"user-profile:NCFsMdcF0NkYyxY4BJfib:local-mini","defaultInferenceProfileId":null,"defaultSandboxType":"vercel","defaultManagedRuntimeProfileId":"user-profile-sDpTohhw9n6Z-cnTUEL7L","defaultDiffMo
  ```

## J-INFPROF-01: Inference profile create, read, update, delete

Result: **FAIL** (6 passed, 1 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ list existing profiles | `GET /api/inference-profiles` | 200 | profiles |
| 2 | ✓ reject a profile with no API key | `POST /api/inference-profiles` | 400 | error |
| 3 | ✓ create a profile | `POST /api/inference-profiles` | 201 | profile |
| 4 | ✗ rename the profile via collection-level PATCH | `PATCH /api/inference-profiles` | 400 | error |
| 5 | ✓ per-id read route does not exist | `GET /api/inference-profiles/wj0Iu-lk8YhBRJLIT2w2K` | 404 | — |
| 6 | ✓ list reflects the rename | `GET /api/inference-profiles` | 200 | profiles |
| 7 | ✓ delete the profile via collection-level DELETE | `DELETE /api/inference-profiles` | 200 | success |

### Failures

- **rename the profile via collection-level PATCH** — `PATCH /api/inference-profiles` returned 400 (expected one of 200/201/202/204)
  ```
  {"error":"OpenAI-compatible profiles require a base URL."}
  ```

## J-SESSION-01: Session create, read, rename, archive without a sandbox

Result: **FAIL** (9 passed, 1 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ reject a session with an invalid sandbox type | `POST /api/sessions` | 400 | error |
| 2 | ✓ create a session | `POST /api/sessions` | 200 | chat, session |
| 3 | ✓ read the session | `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9` | 200 | session |
| 4 | ✓ list the session's chats | `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9/chats` | 200 | chats, defaultModelId |
| 5 | ✓ unknown session id is a 404, not a 500 | `GET /api/sessions/definitely-not-a-real-session-id` | 404 | error |
| 6 | ✓ rename the session | `PATCH /api/sessions/CR5h6CQLplPZKbhzj-hP9` | 200 | session |
| 7 | ✗ read the session diff | `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9/diff` | 400 | error |
| 8 | ✓ read session observability | `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9/observability` | 200 | browserRuns, directToolUse, events, externalToolUse, profileRuns, runtimeMode, services, workers, workflowArtifacts, workflowGoals, workflowRuns |
| 9 | ✓ delete the session | `DELETE /api/sessions/CR5h6CQLplPZKbhzj-hP9` | 200 | success |
| 10 | ✓ deleted session is gone | `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9` | 404 | error |

### Failures

- **read the session diff** — `GET /api/sessions/CR5h6CQLplPZKbhzj-hP9/diff` returned 400 (expected one of 200/201/202/204)
  ```
  {"error":"Sandbox not initialized"}
  ```

## J-LOOP-01: Agent loop create, read, update, delete

Result: **FAIL** (3 passed, 1 failed, 4 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ list loops | `GET /api/agent-loops` | 200 | loops |
| 2 | ✓ reject a loop with no name | `POST /api/agent-loops` | 400 | errorKind, message |
| 3 | ✗ create a loop | `POST /api/agent-loops` | 400 | errorKind, message |
| 4 | — read the loop | `GET /api/agent-loops/undefined` | skipped | — |
| 5 | — list the loop's triggers | `GET /api/agent-loops/undefined/triggers` | skipped | — |
| 6 | — list the loop's runs | `GET /api/agent-loops/undefined/runs` | skipped | — |
| 7 | ✓ unknown loop id is a 404 | `GET /api/agent-loops/definitely-not-a-real-loop` | 404 | error |
| 8 | — delete the loop | `DELETE /api/agent-loops/undefined` | skipped | — |

### Failures

- **create a loop** — `POST /api/agent-loops` returned 400 (expected one of 200/201)
  ```
  {"errorKind":"invalid_request","message":"Invalid request body: definition: Invalid input: expected record, received undefined"}
  ```

## J-BGAGENT-01: Background agent create, read, update, delete

Result: **PASS** (3 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ list background agents | `GET /api/background-agents` | 200 | agents |
| 2 | ✓ reject an agent with no repository | `POST /api/background-agents` | 400 | details, error |
| 3 | ✓ list background agent runs | `GET /api/background-agent-runs` | 200 | runs |

## J-PUBLIC-01: Unauthenticated service surfaces

Result: **PASS** (4 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ health probe | `GET /api/health` | 200 | rateLimitBackend, redisConfigured, status |
| 2 | ✓ model catalog | `GET /api/models` | 200 | models |
| 3 | ✓ harness readiness | `GET /api/harness/ready` | 200 | enabled, requestId |
| 4 | ✓ unknown shared id is a 404 | `GET /api/shared/definitely-not-a-real-share/status` | 404 | error |
