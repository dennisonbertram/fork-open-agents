# API duplication, drift, and spaghetti

Structural problems found while mapping and exercising the API. This is a
report, not a change proposal — nothing here has been verified as safe to
remove, and several duplicates exist for defensible reasons.

Sources: the redundancy notes recorded by the topic agents that read every route
file (`docs/ux-paths/topics/*.md`, consolidated in `docs/ux-paths/catalog.md`),
plus the live and static analysis in [README.md](README.md).

## 1. Literal code duplication

| What | Where | Note |
| ---- | ----- | ---- |
| `commandSchema` + `updateProfileSchema` | `app/api/settings/runtime-profiles/*` and `app/api/sessions/[sessionId]/managed-runtime/profiles/*` | The zod schemas are duplicated verbatim across the account-scoped and session-scoped copies of the same resource. They will drift. |
| Cron/sweep handlers | `GET` and `POST` on `/api/background-agents/cron`; `GET` and `POST` on `/api/agent-loops/sweep` | Each pair shares one handler with identical semantics — two methods documented as one behavior. |
| PR content generation | `POST /api/sessions/[sessionId]/git/pr/generate` and `POST /api/generate-pr` | Both call `generatePullRequestContentFromSandbox`. Their "Sandbox not initialized" contracts were 409 vs 400; both now return `409` (issue #1057), but the bodies still differ: `/api/generate-pr` uses `sandboxNotInitializedResponse()` and returns `{"error":"Sandbox not initialized","errorKind":"sandbox_not_initialized"}`, while the session route surfaces the thrown error through `mapGitActionError`, which emits only `{"error":"Sandbox not initialized"}` — no `errorKind`. |

That last row is the clearest evidence that duplication here is not harmless:
two routes wrapping one function drifted apart on status code, and even after
the status codes were reconciled their error bodies still disagree.

## 2. One goal, many routes

Fourteen goals are reachable through more than one route. The ones where the
duplicates are not obviously intentional:

- **Set a chat title** — three ways: `POST /api/generate-title`, `PATCH /api/sessions/[id]/chats/[chatId]` with `{title}`, and auto-titling inside the chat workflow.
- **Persist an assistant message** — three write paths: `POST /api/sessions/[id]/chats/[chatId]/messages`, `POST /api/chat/[chatId]/stop` with an `assistantMessage`, and implicit persistence inside `POST /api/chat`.
- **Create a branch** — `POST /api/sessions/[id]/git/branch` and `POST /api/generate-pr` with `{createBranchOnly:true}`. Both auto-name and persist `session.branch`.
- **Pause a sandbox** — `DELETE /api/sandbox` and `POST /api/sandbox/snapshot`. Both call `connectSandbox(...).stop()` and clear `sandboxState`; they differ only in response shape, whether `lifecycleVersion` bumps, and rate limiting.
- **Start a Verified Build run** — `POST /api/harness/runs` (202 JSON) and `POST /api/chat` auto-routing (200 SSE). Same DB record, two contracts.
- **Force an installation sync** — five routes fire `syncUserInstallations` as a side effect (`connection-status`, `orgs/install-status`, `app/install`, `app/callback`, `post-link`) and there is no dedicated endpoint for it. Callers trigger a write by reading.

That last one is the worst pattern: a GET with a side effect, repeated five times.

## 3. One fact, many endpoints

| Data | Number of endpoints |
| ---- | ------------------- |
| Background-agent run status + output URL | 5 |
| Force installation sync | 5 |
| Sandbox liveness | 3 (`/api/sandbox/status`, `/api/sandbox/reconnect`, `GET /api/sessions/[id]`) |
| Chat streaming state | 3 |
| Harness run events | 3 |
| Loop triggers | 2 (only the standalone one adds `humanizedSchedule`) |

`/api/sandbox/status` and `/api/sandbox/reconnect` return a **byte-identical
`lifecycle` block**. A client has no way to know which is canonical.

**Loop run data is split so that no endpoint is sufficient:**
`/api/agent-loops/[loopId]/runs` has `failedStepCount` but no steps or events;
`/api/agent-loop-runs/[runId]` has steps and events but no `failedStepCount`. A
client that needs both must call both and merge.

## 4. Convergent auth schemes

A background-agent run can be triggered four ways — signed background webhook,
signed GitHub webhook, cron-secret endpoint, and authenticated manual test — each
with a different auth scheme, all producing one result shape. Four independent
authentication paths into one privileged action is four times the surface to get
wrong, and any hardening has to be applied four times.

## 5. Error contracts (detail in [README.md](README.md))

62 distinct error body shapes across 462 error responses, with two incompatible
conventions for the message field (`error` vs `message`) and 11 responses that
carry no body at all. This is the single largest obstacle to a frontend
consuming this API reliably.

## Ranking

If only three things get fixed, these have the highest ratio of client pain to
change cost:

1. **One error envelope** (#1054) — every client touches this.
2. **`/api/sandbox/status` vs `/api/sandbox/reconnect`** — pick one as canonical; the payloads are already identical.
3. **The `generate-pr` / `git/pr/generate` error-body disagreement** — two routes, one function. The status codes now agree (both 409), but only `/api/generate-pr` carries `errorKind`; `mapGitActionError` never adds it. Cheap to reconcile and currently actively misleading.
