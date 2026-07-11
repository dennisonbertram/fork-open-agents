# Session Durability Proof

This document records the deterministic contract for reconnecting an
interactive coding Session. It covers the durable chat stream and the named
persistent sandbox independently; neither transient browser state nor an
assistant summary is a source of truth.

## Protected path

Start a repository Session, begin a long-running chat, disconnect or refresh,
and reopen the same Session. The client must attach to the existing workflow
stream and persistent sandbox rather than creating duplicate work or replacing
the workspace. A hibernated sandbox resumes only through the explicit resume
route.

## Sources of truth

| Concern | Durable source | Required behavior |
| --- | --- | --- |
| Active chat work | `chats.activeStreamId` | Reconnect reads the recorded workflow run. HTTP and workflow claims are idempotent, and stale clears use compare-and-set so an older run cannot clear a newer owner. |
| Terminal chat state | Workflow run status plus `chats.activeStreamId` | Completed, cancelled, failed, or absent runs clear only their matching stream id and return the existing no-stream response. |
| Persistent workspace identity | `sessions.sandboxState.sandboxName` | Create, reconnect, pause, and resume retain the same `session_<sessionId>` name. Runtime expiry fields may change; the persistent name does not. |
| Hibernated workspace | A sandbox state containing the persistent name without live expiry | Resume calls the provider with `resume: true`. It does not create a replacement unless the legacy snapshot migration path explicitly uses `createIfMissing`. |

Persistent Session sandboxes and disposable background/loop workspaces remain
different policies. This proof does not allow an interactive Session to adopt a
fresh-per-run or fresh-per-step sandbox policy.

## Ownership and idempotency

- Stream routes resolve chat ownership before reading `activeStreamId`.
- Sandbox reconnect and resume resolve Session ownership before invoking the
  provider or returning sandbox identity.
- Repeated stream GETs attach to the same workflow run without changing the
  stream owner.
- Repeated resume calls connect once; after the first call persists live state,
  the next call returns `alreadyRunning` without a second provider resume.
- Terminal stream clearing and new workflow claims use atomic compare-and-set or
  idempotent claim operations.

## Safe evidence contract

Reconnect and lifecycle responses include a safe `requestId`. Successful
resume responses include the persistent `sandboxName` and `restoredFrom`
identity. Recovery paths use stable kinds:

| Kind | Meaning |
| --- | --- |
| `sandbox_reconnect_transient` | The live probe failed transiently; persisted runtime state was preserved for a later retry. |
| `sandbox_unavailable` | The persisted runtime is hard-unavailable and the Session moved to hibernated recovery state. |
| `sandbox_pause_failed` | The provider could not pause the persistent sandbox; retry is allowed. |
| `sandbox_resume_state_missing` | No persistent name or legacy snapshot exists to resume. |
| `sandbox_resume_unavailable` | The saved persistent sandbox no longer exists; explicit new-sandbox recovery is required. |
| `sandbox_resume_failed` | Resume failed for a retryable provider or control-plane reason. |

Lifecycle logs contain correlation and identity metadata, transition, and the
typed kind. They do not include raw provider messages, prompts, transcripts,
cookies, tokens, credentials, or environment values.

## Continuous proof

Level 1 deterministic coverage is provided by:

```bash
bun test --isolate \
  'apps/web/app/api/chat/[chatId]/stream/route.test.ts' \
  apps/web/app/api/chat/route.test.ts \
  apps/web/app/workflows/chat.test.ts \
  apps/web/app/api/sandbox/reconnect/route.test.ts \
  apps/web/app/api/sandbox/snapshot/route.test.ts \
  apps/web/app/api/sandbox/route.test.ts \
  apps/web/app/api/sessions/_lib/session-context.test.ts \
  packages/sandbox/vercel/sandbox.test.ts
```

The route tests assert repeated reattachment, no duplicate workflow start,
terminal clearing, ownership boundaries, persistent-name reuse, idempotent
resume, typed recovery, and redaction. The package test proves the Vercel
adapter reconnects by persistent name and distinguishes resumed from newly
created sandboxes.

## Proof limits

Level 1 tests use deterministic workflow and sandbox doubles. They do not prove
that Vercel retained a real MicroVM across hibernation, that a live Workflow
deployment replayed chunks after a browser disconnect, or that repository files
and branch state survived provider-level resume. Those claims require:

1. configured local or preview authentication and database state,
2. a disposable repository,
3. a real persistent sandbox name recorded before and after resume,
4. workflow run and stream evidence before and after refresh,
5. repository/branch checks inside the resumed sandbox,
6. browser, server-log, and provider evidence with secrets redacted.

Do not promote this Level 1 contract to a live sandbox or production durability
claim without that evidence bundle.
