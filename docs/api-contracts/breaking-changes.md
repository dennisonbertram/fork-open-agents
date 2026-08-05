# Breaking API changes and the frontend work they need

One planned change to the error contract is visible to clients. This names
exactly which routes, which frontend files, and in what order the work has to
land so nothing breaks in between.

Design decision and rationale: issue #1054.

## The change

Error bodies move to one envelope:

```ts
type ApiErrorBody = {
  error: string;                     // human-readable, always present
  errorKind: ApiErrorKind;           // stable snake_case code to branch on
  fields?: Record<string, string>;   // field-level validation detail
  retryAfterSeconds?: number;        // on 429 and retryable 503
};
```

For **322 of 464** inline error responses this is purely additive — they already
return `{ error }` and simply gain `errorKind`. Nothing breaks.

**The breaking group is the 40 responses that return `message` instead of
`error`.** Renaming that field changes what a client reads.

## Exactly which routes break

11 route files, 40 response sites, all in the agent-loops / automations area:

| Route file | Statuses affected |
| ---------- | ----------------- |
| `/api/agent-loops/route.ts` | 400, 403 |
| `/api/agent-loops/[loopId]/route.ts` | 400, 403 |
| `/api/agent-loops/[loopId]/runs/route.ts` | 400, 403, 409, 502, 503 |
| `/api/agent-loops/[loopId]/triggers/route.ts` | 400, 403 |
| `/api/agent-loops/[loopId]/triggers/[triggerId]/route.ts` | 400, 403 |
| `/api/agent-loops/draft/route.ts` | 400, 403, 422, 502 |
| `/api/agent-loop-runs/[runId]/cancel/route.ts` | 403 |
| `/api/agent-loop-runs/[runId]/pause/route.ts` | 403 |
| `/api/agent-loop-runs/[runId]/resume/route.ts` | 403 |
| `/api/agent-loop-runs/[runId]/retry/route.ts` | 403 |
| `/api/automations/route.ts` | 400 |

Reproduce this list:

```bash
grep -rln 'errorKind' apps/web/app/api --include=route.ts
# then check each Response.json literal for `message:` with no `error:`
```

## Frontend files that consume them

| File | Calls |
| ---- | ----- |
| `apps/web/app/loops/[loopId]/loop-detail.tsx` | `/api/agent-loops/[loopId]` |
| `apps/web/app/loops/[loopId]/builder/builder-canvas.tsx` | `/api/agent-loops/[loopId]` |
| `apps/web/app/loops/[loopId]/loop-triggers-card.tsx` | `/api/agent-loops/[loopId]/triggers` |
| `apps/web/app/loops/[loopId]/runs/[runId]/run-actions.tsx` | `/api/agent-loop-runs/[runId]/{cancel,pause,resume,retry}` |
| `apps/web/app/loops/[loopId]/runs/[runId]/use-loop-run-polling.ts` | `/api/agent-loop-runs/[runId]` |
| `apps/web/scripts/agent-loop-journey-proof.ts` | loop journey proof script |

`/api/automations` has **no frontend caller** — only generated Next.js route
types reference it. It can migrate with no client work.

## The transition rule

Reading both shapes is correct during and after the migration. It does not need
removing on a deadline:

```ts
const message = body.error ?? body.message ?? "Something went wrong";
const kind = body.errorKind ?? "unknown";
```

`apps/web/lib/api/read-api-error.ts` implements this. Frontend callers should use
it rather than reading fields directly.

## Order of work

1. **Ship the helper and the exported type.** No route changes. Non-breaking.
2. **Ship the frontend reader and migrate the callers above to it.** Non-breaking —
   the reader handles the legacy shape, so this is safe while the API is unchanged.
3. **Migrate the 40 responses onto the envelope.** Only safe once step 2 has landed.
4. **Change the shared helpers** (`jsonError` and friends) to emit the envelope. That
   covers 81 further responses without touching their call sites.
5. **Backfill `errorKind`** on the `{ error }` majority, route group by route group.
   Purely additive; can proceed at any pace.

Steps 1, 2, 4 and 5 are non-breaking. **Only step 3 changes a wire shape a client
reads, and it must not land before step 2.**

## Why bother

Four separate bugs found while exercising the API were the same shape: a failure
attributed to the wrong subsystem, sending the user to fix the wrong thing.

| Bug | Blamed | Actually |
| --- | ------ | -------- |
| #1063 | Composio API key | AI Gateway auth |
| #1065 | Workspace drift baseline | Unreachable subagent model |
| #1061 review | "Reconnect GitHub" | GitHub rate limit |
| #1064 review | AI Gateway key | Inference profile disappeared |

Every one was a classification bug, and no client could have caught any of them,
because there was nothing stable to classify on. That is what `errorKind` is for.

## Deprecated (still working): collection-level PATCH/DELETE on inference profiles

Issue #1055. Inference profiles were the only resource that mutated through the
collection URL with the id in the request body, and they had no per-id read
route — `GET /api/inference-profiles/{id}` returned the Next.js HTML 404 page
rather than JSON.

The per-id routes now exist and are the supported shape:

| Method | Path | Status |
| ------ | ---- | ------ |
| `GET` | `/api/inference-profiles/{profileId}` | new, use this |
| `PATCH` | `/api/inference-profiles/{profileId}` | new, use this — `profileId` in the body is ignored |
| `DELETE` | `/api/inference-profiles/{profileId}` | new, use this — no body needed |
| `PATCH` | `/api/inference-profiles` (id in body) | deprecated, still works |
| `DELETE` | `/api/inference-profiles` (id in body) | deprecated, still works |

Not a breaking change: nothing was removed, and both shapes run the same
implementation (`apps/web/app/api/inference-profiles/_lib/profile-handlers.ts`),
so they cannot diverge. The partial-update behavior fixed in #1069 — a
rename-only patch must not clear `baseUrl` — holds identically on both.

New callers should use the per-id routes. The settings UI
(`apps/web/app/settings/inference-profiles-section.tsx`) already does. No removal
date is set for the collection-level shape.

## Frontend adoption: final state

Every frontend read of an **API error response body** now goes through
`readApiError` (`apps/web/lib/api/read-api-error.ts`). 38 files use it, across
settings, sessions, repos, tool-call components and the data hooks.

### What is deliberately not migrated

19 `.error ??` / `.error ||` reads remain in the frontend tree. **None of them
reads an HTTP error body**, so routing them through the reader would be wrong:

| Where | Count | What `.error` actually is |
| ----- | ----- | ------------------------- |
| `components/tool-call/renderers/*` | 10 | `output.error` on a streamed tool result — agent output, never an HTTP response |
| `app/workflows/chat.ts` | 2 | server-side workflow code, not a client |
| `app/settings/admin/admin-content.tsx` | 2 | `result.error` from a server action return value |
| `app/sessions/.../session-chat-content.tsx` | 2 | `part.data.error` on a streamed message part |
| `app/settings/accounts-section.tsx` | 1 | server action return value |
| `app/repos/.../secrets`, `.../actions` | 2 | SWR's `error` object from the hook, not a body |

The distinction that matters: `readApiError` parses a **response body**. A
server-action return value, an SWR error object, and a streamed tool result are
different things that happen to use the same field name. Migrating them would
add indirection and lose type safety.

### Guarding the parse

The migration initially left `await res.json()` unguarded on several error
paths. That is worse than it looks: when a server returns a non-JSON error — an
HTML gateway page, an empty body — `res.json()` **rejects before the reader
runs**, so the user sees a raw `SyntaxError` instead of the intended message.

The pattern is:

```ts
const parsed = readApiError(await res.json().catch(() => null), "Fallback text");
```

The `.catch` belongs on the **error path only**. One fix put it on the success
path, which meant an unreadable 2xx resolved to `null` and looked like success —
caught in review, and worth watching for.
