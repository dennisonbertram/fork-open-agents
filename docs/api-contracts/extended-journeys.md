# API contract: extended journeys

Observed by running `scripts/api-exercise/journeys-extended.ts` against a local server.
These cover the route paths that `journeys-core.ts` does not touch.

## J-X-AUTOMATIONS-01: Unified automations and runs listings

Result: **PASS** (7 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ anonymous caller cannot list automations | `GET /api/automations` | 401 | error |
| 2 | ✓ list automations | `GET /api/automations` | 200 | automations, facets, requestId, sourceStatus, total |
| 3 | ✓ reject an unknown automation kind filter | `GET /api/automations?kind=not-a-real-kind` | 400 | errorKind, message, requestId |
| 4 | ✓ reject a malformed repository filter | `GET /api/automations?repository=owner-with-no-slash` | 400 | errorKind, message, requestId |
| 5 | ✓ anonymous caller cannot list runs | `GET /api/runs` | 401 | error |
| 6 | ✓ list runs | `GET /api/runs` | 200 | allSourcesFailed, generatedAt, items, nextCursor, requestId, sourceStatus |
| 7 | ✓ reject a non-numeric runs limit | `GET /api/runs?limit=abc` | 400 | error, requestId |

## J-X-LEARNINGS-01: Repo learnings feed, toggle and per-learning mutations

Result: **PASS** (10 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ anonymous caller cannot read the learnings feed | `GET /api/learnings` | 401 | error |
| 2 | ✓ learnings feed without a repo returns an empty feed | `GET /api/learnings` | 200 | enabled, learnings, verdict |
| 3 | ✓ learnings feed for a specific repo | `GET /api/learnings?repoOwner=dennisonbertram&repoName=fork-open-agents` | 200 | enabled, learnings, verdict |
| 4 | ✓ reject a toggle with no repoName or enabled flag | `POST /api/learnings` | 400 | error |
| 5 | ✓ disable the learnings agent for a repo | `POST /api/learnings` | 200 | enabled, verdict |
| 6 | ✓ the disabled state is reflected in the feed | `GET /api/learnings?repoOwner=dennisonbertram&repoName=fork-open-agents` | 200 | enabled, learnings, verdict |
| 7 | ✓ unknown learning id is a 404 | `GET /api/learnings/definitely-not-a-real-learning` | 404 | error, errorKind |
| 8 | ✓ re-enabling is refused without a GitHub App installation (asymmetric toggle) | `POST /api/learnings` | 404 | verdict |
| 9 | ✓ PATCH on an unknown learning is a 404, not a validation error | `PATCH /api/learnings/definitely-not-a-real-learning` | 404 | error, errorKind |
| 10 | ✓ DELETE (archive) on an unknown learning is a 404 | `DELETE /api/learnings/definitely-not-a-real-learning` | 404 | error, errorKind |

## J-X-GITHUB-01: GitHub repo secrets and Actions routes without a GitHub credential

Result: **PASS** (10 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ anonymous caller cannot list repo secrets | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/secrets` | 401 | error |
| 2 | ✓ list repo secrets is denied with a typed 403 for an unconnected identity | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/secrets` | 403 | error, errorKind, ok |
| 3 | ✓ create a repo secret is denied with a typed 403 | `POST /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/secrets` | 403 | error, errorKind, ok |
| 4 | ✓ update a repo secret is denied with a typed 403 | `PUT /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/secrets/OPEN_AGENTS_CONTRACT_PROBE` | 403 | error, errorKind, ok |
| 5 | ✓ delete a repo secret is denied with a typed 403 | `DELETE /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/secrets/OPEN_AGENTS_CONTRACT_PROBE` | 403 | error, errorKind, ok |
| 6 | ✓ anonymous caller cannot list Actions workflows | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/actions/workflows` | 401 | error |
| 7 | ✓ list Actions workflows is denied with a typed 403 | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/actions/workflows` | 403 | error, errorKind, ok |
| 8 | ✓ dispatch a workflow is denied with a typed 403 | `POST /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/actions/workflows/ci.yml/dispatch` | 403 | error, errorKind, ok |
| 9 | ✓ job logs with a non-numeric id is denied with a typed 403 | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/actions/jobs/not-a-number/logs` | 403 | error, errorKind, ok |
| 10 | ✓ job logs for a numeric id is denied with a typed 403 | `GET /api/github/repos/open-agents-contract-probe/repo-that-does-not-exist/actions/jobs/123456789/logs` | 403 | error, errorKind, ok |

## J-X-SESSION-DIAG-01: Session browser runs and chat debug bundle

Result: **PASS** (12 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ create a session | `POST /api/sessions` | 200 | chat, session |
| 2 | ✓ create a chat in the session | `POST /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats` | 200 | chat |
| 3 | ✓ browser runs list is empty for a classic-runtime session | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/browser-runs` | 200 | runs |
| 4 | ✓ starting a browser run without a sandbox is a 409 | `POST /api/sessions/Ie-ITpd68CkHJ7xE409mb/browser-runs` | 409 | error |
| 5 | ✓ browser runs for an unknown session is a 404 | `GET /api/sessions/definitely-not-a-real-session-id/browser-runs` | 404 | error |
| 6 | ✓ read the chat debug bundle as JSON | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/9poRc3Z916FwnFDritYoO/debug-bundle` | 200 | bundle, chat, events, runtime, session, transcript |
| 7 | ✓ read the same bundle as markdown | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/9poRc3Z916FwnFDritYoO/debug-bundle?format=markdown` | 200 | — |
| 8 | ✓ mint a signed diagnostic bundle URL | `POST /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/9poRc3Z916FwnFDritYoO/debug-bundle` | 200 | expiresAt, redaction, token, url |
| 9 | ✓ the signed token grants anonymous read access to the bundle | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/9poRc3Z916FwnFDritYoO/debug-bundle?token=eyJ2IjoxLCJzaWQiOiJJZS1JVHBkNjhDa0hKN3hFNDA5bWIiLCJjaWQiOiI5cG9SYzNaOTE2RnduRkRyaXRZb08iLCJleHAiOjE3ODU3MTE5NjQzNDl9.bmtC-XC4j9YcV9OhVrdwkN3MZYeiXwjsS-MYHC45-QI` | 200 | bundle, chat, events, runtime, session, transcript |
| 10 | ✓ a forged diagnostic token is a 401 | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/9poRc3Z916FwnFDritYoO/debug-bundle?token=not-a-real-token` | 401 | error |
| 11 | ✓ an unknown chat id is a 404 | `GET /api/sessions/Ie-ITpd68CkHJ7xE409mb/chats/definitely-not-a-real-chat/debug-bundle` | 404 | error |
| 12 | ✓ clean up the session | `DELETE /api/sessions/Ie-ITpd68CkHJ7xE409mb` | 200 | success |

## J-X-MISC-01: Transcription, usage rank, Vercel repo projects, workflow catalog

Result: **PASS** (10 passed, 0 failed, 0 skipped)

| # | Step | Call | Status | Response keys |
| - | ---- | ---- | ------ | ------------- |
| 1 | ✓ anonymous caller cannot transcribe | `POST /api/transcribe` | 401 | error |
| 2 | ✓ transcribe rejects a body with no audio | `POST /api/transcribe` | 400 | error |
| 3 | ✓ undecodable audio is reported as a 500 (should be a 4xx) | `POST /api/transcribe` | 500 | error |
| 4 | ✓ anonymous caller cannot read their usage rank | `GET /api/usage/rank` | 401 | error |
| 5 | ✓ usage rank returns null when the user has no ranked domain | `GET /api/usage/rank` | 200 | — |
| 6 | ✓ anonymous caller cannot list Vercel repo projects | `GET /api/vercel/repo-projects` | 401 | error |
| 7 | ✓ Vercel repo projects requires repoOwner and repoName | `GET /api/vercel/repo-projects` | 400 | error |
| 8 | ✓ Vercel repo projects is a typed 403 without a connected Vercel account | `GET /api/vercel/repo-projects?repoOwner=open-agents-contract-probe&repoName=repo-that-does-not-exist` | 403 | error |
| 9 | ✓ anonymous caller cannot read the workflow catalog | `GET /api/workflows/catalog` | 401 | error |
| 10 | ✓ workflow catalog is 404 while the product surface is unexposed | `GET /api/workflows/catalog` | 404 | errorKind, message |
