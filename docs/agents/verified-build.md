# Verified Build Domain Audit Scratchpad

## Files Read
- docs/agents/lessons-learned.md (lessons 93, 150 relevant)
- lib/verified-build/mode-policy.ts
- lib/verified-build/mode-policy.test.ts
- lib/verified-build/task-classifier.ts
- lib/verified-build/task-classifier.test.ts
- lib/harness/client.ts
- lib/harness/client-error.ts
- lib/harness/config.ts
- lib/harness/events.ts (SSE parsing, event reduction)
- lib/harness/logger.ts
- lib/harness/redaction.ts
- lib/harness/request-id.ts
- lib/harness/run-mapping.ts
- lib/harness/types.ts
- lib/db/schema.ts (verifiedBuildRuns + verifiedBuildEvents tables, lines 810-892)
- lib/observability/events.ts (emitSessionEvent)
- app/api/harness/ready/route.ts
- app/api/harness/runs/route.ts
- app/api/harness/runs/route.test.ts
- app/api/harness/runs/[runId]/route.ts
- app/api/harness/runs/[runId]/events/route.ts
- app/api/harness/runs/[runId]/approve/route.ts
- app/api/harness/runs/[runId]/approve/route.test.ts
- app/api/harness/runs/[runId]/cancel/route.ts
- app/api/harness/runs/[runId]/repair/route.ts
- app/api/harness/runs/[runId]/artifacts/route.ts
- app/api/harness/runs/[runId]/audit/route.ts
- app/api/harness/runs/[runId]/capsules/route.ts
- app/api/harness/runs/[runId]/trace/route.ts
- app/api/harness/runs/[runId]/trace/export-plan/route.ts
- app/api/harness/artifacts/[artifactId]/route.ts
- app/api/harness/workcells/[workcellId]/route.ts
- app/api/harness/_lib/proxy.ts
- app/api/harness/_lib/responses.ts
- app/api/harness/_lib/run-access.ts
- app/api/chat/route.ts (verified-build decision path, lines 169-237)
- app/sessions/[sessionId]/chats/[chatId]/hooks/use-verified-build-events.ts
- app/sessions/[sessionId]/chats/[chatId]/hooks/use-verified-build-run.ts
- app/sessions/[sessionId]/chats/[chatId]/verified-build-approvals.tsx

## Assumptions
1. The harness service is an external API that Open Agents proxies to.
2. Verified-build runs are scoped to session+chat+user, with idempotency keys derived from (sessionId, chatId, latestUserMessageId, mode).
3. SSE events flow from harness -> our API route -> browser. Events are persisted with `onConflictDoNothing` on (verifiedBuildRunId, harnessEventId).
4. Session events (observability ledger) are emitted as a side effect of persisting verified-build events.
5. AuthZ for run access is checked via `getVerifiedBuildRunByIdForUser` which filters by runId + userId.

## Candidate Defects Considered

### 1. SSE Reconnect Storm (ACCEPTED - MEDIUM)
`use-verified-build-events.ts` includes `lastEventId` in the useEffect dependency array. Each new SSE event updates the events array, which changes `lastEventId` (useMemo), which recreates the EventSource. This causes a full SSE reconnect on every event.

Verdict: Real defect. Each event arrival triggers closing the current SSE connection and opening a new one. In a busy run with frequent events, this creates constant connection churn. The server must replay from lastEventId each time.

### 2. Idempotency Race in startVerifiedBuildRun (ACCEPTED - MEDIUM)
`startVerifiedBuildRun` checks for existing run by idempotency key, then creates a harness run, then inserts into DB. No transaction wraps the check+insert. Two concurrent calls can both pass the check, both create harness runs, and then one insert fails on the unique constraint. The orphan harness run from the loser is never cleaned up.

Verdict: Real defect but bounded severity. The DB unique constraint prevents data corruption, but an orphan harness run is created. The second caller gets a 500/502 error.

### 3. Cancel Action Optimistic Write Before Harness Call (ACCEPTED - MEDIUM)
In `proxyRunAction` (proxy.ts lines 82-86), the cancel action writes "cancellation_requested" to DB BEFORE calling the harness to actually cancel. If the harness call fails, the DB is left in a stale state with no rollback.

Verdict: Real data-integrity defect. The cancel status persists even when the downstream cancellation failed.

### 4. /api/harness/ready Lacks Authentication (REJECTED - by design)
This is a readiness check endpoint. It doesn't expose user data, only harness health/config. It's designed to be probed without auth so the UI can check harness status before auth.

Verdict: By design, not a defect.

### 5. SSE Stream Infinite Hang Without Timeout (REJECTED - req.signal handles it)
`openRunEvents` doesn't apply `requestTimeoutMs`. But `req.signal` is passed and aborts when the client disconnects.

Verdict: Not a defect; browser disconnect propagates via AbortSignal.

### 6. Lesson 93: SSE Event Dedup to Session Ledger (REJECTED - fix already in place)
`persistVerifiedBuildEvent` uses `onConflictDoNothing` and checks the `returning` result. If the insert was a no-op (existing event), it returns early without emitting a session event. This correctly implements the lesson.

Verdict: Fix already present, no finding.

### 7. Lesson 150: FK Constraint Testing (REJECTED - not applicable)
The test mocks in run-mapping don't validate FK shapes. But this is a testing concern, not a production code defect. The actual DB enforces FKs.

Verdict: Testing improvement area, not a runtime defect.

### 8. Missing Transaction on Run Creation Insert (ACCEPTED - related to finding 2)
The `startVerifiedBuildRun` insert at line 260-281 is not in a transaction. While the unique constraint provides a safety net, the harness service call between check and insert is the real gap.

Verdict: Covered by finding 2.

### 9. Duplicate session event emission for run start (REJECTED - single call path)
`emitSessionEvent` is called once at line 287-304 in `startVerifiedBuildRun`, after the insert. There's no duplicate path.

Verdict: Not a defect.

## Coverage Gaps
- Not reviewed: `verified-build-workcells.tsx`, `verified-build-timeline.tsx`, `verified-build-observability.tsx` (UI components)
- Not reviewed: harness config integration tests across all env states
- Not reviewed: verified-build panel test manually
- Not reviewed: the full chat route's error handling around the harness create call (the catch at line 228-236)
