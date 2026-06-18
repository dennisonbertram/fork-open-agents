# Audit: Chat request lifecycle & streaming

Domain: apps/web/app/api/chat, apps/web/lib/chat, apps/web/lib/chat-streaming-state,
apps/web/lib/chat-instance-manager, apps/web/lib/abortable-chat-transport,
apps/web/lib/chat-auto-commit, apps/web/lib/chat-route-cleanup.

## Files read
- docs/agents/lessons-learned.md (full)
- apps/web/app/api/chat/route.ts
- apps/web/app/api/chat/_lib/{chat-context,request,persist-tool-results,runtime}.ts
- apps/web/app/api/chat/[chatId]/{stop,stream}/route.ts
- apps/web/lib/chat-streaming-state.ts
- apps/web/lib/chat-instance-manager.ts
- apps/web/lib/abortable-chat-transport.ts
- apps/web/lib/chat-route-cleanup.ts
- apps/web/lib/chat-auto-commit.ts (runAutoCommitInBackground — DEAD, only def+test)
- apps/web/lib/chat/create-cancelable-readable-stream.ts
- apps/web/lib/chat/sanitize-interrupted-tool-calls.ts
- apps/web/lib/db/sessions.ts (stream-id + message persistence helpers, lines 425-720)
- apps/web/app/workflows/chat.ts (persistence/finish/finally sections: 1340-1460, 1700-2050, 2540-2550)
- apps/web/app/workflows/chat-post-finish.ts (full)
- apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts
- apps/web/app/sessions/[sessionId]/chats/[chatId]/stream-recovery-policy.ts
- apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-stream-recovery.ts
- apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-auto-commit-status.ts
- apps/web/hooks/use-session-chats.ts (optimistic overlay + title rollback)

## Working assumptions (corrections as I learn)
- Architecture: POST /api/chat starts a durable Vercel Workflow runAgentWorkflow.
  activeStreamId = workflow runId. Workflow self-claims it as step 1
  (claimActiveStream). Route also claims after start() (claimChatActiveStreamId).
  Workflow clears it on finish/finally via compareAndSetChatActiveStreamId
  (only clears if still its own runId). This matches lessons 106, 50.
- POST /api/chat/[chatId]/stop: cancels the run, clears activeStreamId via CAS.
  Correct (lesson 106 fix in place).
- GET /api/chat/[chatId]/stream: resume endpoint. If run terminal -> clear + 204.
  If run not found -> clear + 204. Uses NON-atomic updateChatActiveStreamId.
- Client: use-session-chat-runtime.ts owns transport abort, route teardown,
  reactive resume probe loop. AbortableChatTransport wraps fetch w/ abort signal
  (lesson 116 fix). cleanupChatRouteOnUnmount does NOT call stop() (correct,
  lesson 103).
- Post-turn automations: runAutoCommitStep / runAutoCreatePrStep run as workflow
  steps (server-side durable). lib/chat-auto-commit.ts runAutoCommitInBackground
  is DEAD CODE (no live callers) — lesson 109 fix in place server-side.
- Optimistic title rollback: session-chat-content.tsx wires setChatTitle/
  clearChatTitle with rollback on send failure. Lessons 113, 114 fixes present.

## Candidate defects considered

### ACCEPTED

1. GET /api/chat/[chatId]/stream uses NON-atomic activeStreamId clear
   (updateChatActiveStreamId) in two branches (terminal-run branch L52,
   run-not-found catch L63). Everywhere else the codebase uses
   compareAndSetChatActiveStreamId to avoid clobbering a newer run that raced
   in. CONCRETE TRIGGER: Run A finishes/throws while a NEW POST for the same
   chat (Run B) has already claimed the slot with its runId and is executing.
   A concurrent GET resume (e.g. the client probe loop / page refresh /
   visibility recovery) hits the resume endpoint. If getRun(A.runId) returns
   terminal OR throws, the handler unconditionally sets activeStreamId = null,
   wiping B.runId. Now the chat looks idle while B is still running -> client
   can't resume B; worse, a follow-up POST sees slot null and starts Run C,
   duplicating B's work. This is exactly the stale-token / premature-clear
   class the rest of the codebase guards with CAS. Severity medium-high,
   confidence high.

   Wait — re-examine: the GET reads chat.activeStreamId once at the top (L40
   runId = chat.activeStreamId). Between that read and the
   updateChatActiveStreamId(null) write, a POST could have flipped the slot to
   a new runId. The unconditional null write clobbers it. Real TOCTOU.

2. Re-examine GET stream race vs reconcileExistingActiveStream in POST. The POST
   reconcile loop also clears stale tokens but uses CAS (compareAndSet) —
   consistent. Only the GET route is inconsistent. Confirms #1 is a real gap.

### REJECTED
- POST route double-claim race (reconcile then claimChatActiveStreamId): the
  claim is atomic; loser cancels its own run. Handled.
- onFinish-only persistence gap (lesson 104): fixed — persistAssistantMessage
  is called after each step (chat.ts:1721, 1968, 2003) and tool-result
  snapshots upserted at request start (persist-tool-results.ts). The
  request-start assistant snapshot IS persisted with scoped ownership guard
  (upsertChatMessageScoped, lesson 105 fix in place).
- chat.stop() not aborting reconnect (lesson 116): fixed via
  AbortableChatTransport.abort() paired with stop in retryChatStream
  (use-session-chat-runtime.ts:240-241).
- Client-only post-turn automations (lesson 109): fixed server-side.
- Optimistic title rollback missing (lessons 113,114): present.
- Double-retry replay/flicker (lesson 117): retryChatStream has single-flight
  guard (retryInFlightRef) and soft/hard strategy. Probe loop is status-gated.
  Acceptable.
- Premature interrupted marking (lesson 118): isChatInFlight treats both
  submitted+streaming as in-flight (chat-streaming-state.ts:13-15). Fixed.

## PRIMARY FINDING (verified)
GET /api/chat/[chatId]/stream/route.ts L52 and L63 clear activeStreamId via the
NON-atomic updateChatActiveStreamId() (db/sessions.ts:446-454, plain UPDATE with
no WHERE on current value). Every other clear site in this domain is CAS-protected:
- POST route reconcile: compareAndSetChatActiveStreamId (route.ts:423)
- stop route: compareAndSetChatActiveStreamId (stop/route.ts:67)
- workflow finish/finally: clearActiveStream -> compareAndSet (chat-post-finish.ts:257)

TOCTOU: GET reads chat.activeStreamId at L34 (runId=A), then awaits run.status /
awaits getRun() in a try/catch. Between that read and the unconditional null write,
Run A can finish+CAS-clear (slot=null), a POST can claim Run B (slot=B), and the
GET then nulls B while B is executing. Reachable via the client reactive-resume
probe loop (use-session-chat-runtime.ts:300-358 resumeStream -> GET stream) and
visibility/online recovery (use-stream-recovery.ts).

Effect: chat looks idle while B runs (no resume), and a follow-up POST sees slot
null and starts Run C duplicating B's in-flight work (DB writes, sandbox mutations,
auto-commit) before claimChatActiveStreamId notices.

## Coverage gaps
- Did not fully trace Vercel Workflow SDK internals of getRun()/getReadable()
  multi-reader semantics (whether concurrent GET resumes produce duplicate
  chunk replay server-side). SDK behavior assumed; flagged but not verified.
- Did not exhaustively read the 94KB chat.ts step loop (lines 1500-1700) for
  per-step persistence edge cases; spot-checked finish/finally/clear paths.
- Did not verify the reactive resume probe loop (5 attempts) cannot stack on
  top of an in-flight soft reconnect to cause visible flicker under rapid
  visibility toggling — guarded by status check but not stress-tested.
