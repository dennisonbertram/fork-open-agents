# API contract: the agent run path

A real four-turn conversation driven entirely over HTTP against a local server,
in a live Vercel sandbox, with a real model. This is the path that actually
does the product's work — tool calls, code, git, subagents — and it had never
been exercised end to end.

Every number below is from the recorded SSE stream of that run.

## Preconditions that are easy to get wrong

Two credential problems blocked this for a long time, and neither reported
itself accurately. Both are worth knowing before anyone tries to reproduce:

1. **`VERCEL_OIDC_TOKEN` in `apps/web/.env.local` expires.** The local copy was
   32 days stale. The AI Gateway authenticates with it, so every model call
   failed. `vercel env pull` mints a fresh one — splice only that line into
   `.env.local`; do **not** overwrite the file, or you will point local at the
   production database.
2. **A stale `AI_GATEWAY_API_KEY` takes precedence over OIDC.** Remove it and let
   OIDC authenticate.

A third: an invalid `COMPOSIO_API_KEY` hard-blocks every chat, even with zero
Composio profiles configured. Unsetting it is the only way through. That
behaviour is noted in PR #1064 as needing its own issue.

## Setup

```
POST /api/sessions            {"title":"Agent run exercise"}        -> 201  (no repo)
POST /api/sandbox             {"sessionId":"..."}                   -> 200  readyMs 3316
GET  /api/sessions/[id]/chats                                       -> 200  chat id
```

A repo-less session is enough. The sandbox boots empty and the agent works in it
directly — no GitHub credential needed to exercise tools, code, or git.

## Turn 1 — tool calls and code execution

Prompt: create a git repo at `/vercel/sandbox/demo`, write `fib.py`, run it.

`POST /api/chat` → 200, SSE.

| Chunk type | Count |
| ---------- | ----- |
| `text-delta` | 95 |
| `tool-input-delta` | 81 |
| `reasoning-delta` | 56 |
| `start-step` / `finish-step` | 7 each |
| `tool-input-available` | 6 |
| `tool-output-available` | 6 |

Six `bash` calls. The agent created the repo, wrote the file, ran it, and
returned the correct sequence through F(9) = 34.

## Turn 2 — branch, test, commit

The full message history is sent back on each turn; the server also persists it,
so a client can rebuild the array from `GET /api/sessions/[id]/chats/[chatId]`.

Prompt: create branch `feature/fib-tests`, add `test_fib.py` asserting
`fib(10) == 55`, run it, commit.

**12 steps, 11 tool calls**: `bash`, `read`, `edit`, `write`, then seven more
`bash`. Result: branch `feature/fib-tests`, commit
`2782d5856465f83d65512cf182e61b80db2eb4f1`, four tests passing.

Worth noting: the agent had to configure a git identity itself before the commit
would go through. A sandbox with no `user.email` set is a papercut every
committing agent will hit.

## Turn 3 — subagents fail, and lie about why

Prompt: delegate to subagents via the `task` tool.

Six `task` calls, all failed. The user-facing text:

> "drift check failed closed because no supported baseline was captured."
> "Worker stopped before accepting shared workspace output."
> "This seems to be an infrastructure issue with the subagent system."

The tool output says otherwise:

```json
{"toolCallCount": 0,
 "modelId": "user-profile:NCFsMdcF0NkYyxY4BJfib:local-mini",
 "workspaceResolution": {"status": "accepted", "decision": "shared", ...}}
```

`workspaceResolution.status` is `accepted` — the workspace was healthy. The real
problem was that the configured subagent model pointed at an unreachable local
inference profile, so every worker returned nothing.

## Turn 4 — the control that proves it

Changed one thing:

```
PATCH /api/settings/preferences {"defaultSubagentModelId":"anthropic/claude-haiku-4.5"} -> 200
```

Same chat, same sandbox, same shared-workspace policy. `toolCallCount` climbed
`0 → 1 → 2 → 3 → 4 → 5`, and the explorer subagent returned a correct
file-by-file analysis of the workspace.

One variable, opposite outcome. Filed as a misattributed-error defect.

## Server-side state after the run

```
GET /api/sessions/[id]/files                  -> {"files":[{"value":"demo/","isDirectory":true}]}
GET /api/sessions/[id]/chats/[chatId]         -> 8 messages, 17 persisted tool parts, isStreaming false
GET /api/sessions/[id]/observability          -> workflow events for every step
```

The persisted transcript carries tool parts, so a client reloading the page
recovers the full run.

## What this path proves works

- Multi-turn conversation with history round-tripping through the API
- Real tool calls: `bash`, `read`, `edit`, `write`
- Writing and executing code in the sandbox
- Git branch creation and commit
- Subagent delegation via the `task` tool
- SSE streaming with reasoning, step boundaries, and tool lifecycle chunks
- Server-side persistence of the whole transcript

## What it exposed

| Finding | Issue |
| ------- | ----- |
| An AI Gateway auth failure is reported as a Composio key problem | #1063 (fixed, PR #1064) |
| A subagent failing because its model is unreachable is reported as a workspace drift/baseline failure | filed from this run |
| An invalid `COMPOSIO_API_KEY` hard-blocks every chat even with zero Composio profiles | noted in PR #1064, needs its own issue |
