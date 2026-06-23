# STORY-009 Walk Report: User Recovers From Sandbox Startup Failure

Walked: 2026-06-22
Target: `http://localhost:3002/sessions/6jAQgwU1DNqW08ys3PxXZ/chats/v-DrFpzg6X4RltfuGJVon`
Browser: authenticated in-app browser tab
Status: pass with finding

## Steps

1. Opened the affected chat.
   - Result: chat loaded, but the main assistant failure only said `Workspace setup failed. Try again in a moment.`
   - Evidence: `snapshots/step-1-failed-session-open.txt`.
2. Opened Runtime Inspector.
   - Result: inspector opened with Actors, Session Runtime, Likely Issue, Goal Ledger, Managed Profile, Services, Browser Checks, and Event Timeline.
   - Evidence: `snapshots/step-2-runtime-inspector.txt`.
3. Read failure attribution.
   - Result: Runtime Inspector named workflow `wrun_01KVPBHBAXRKDMN5AQCW7FZ57S`, sandbox `session_6jAQgwU1DNqW08ys3PxXZ`, failed status, and the cause: the saved ZAI inference profile key could not be decrypted and should be re-entered in Settings → Models.
   - Evidence: `snapshots/step-2-runtime-inspector.txt`.
4. Refreshed Runtime Inspector.
   - Result: the same failure evidence remained visible with event names, status badges, retry count, and timestamps from 8:26:26 PM through 8:26:37 PM.
   - Evidence: `snapshots/step-3-runtime-refresh.txt`.

## Findings

- `F-STORY-009-001`: Runtime Inspector has the actionable recovery cause, but the main chat failure remains generic and gives no inline pointer to that evidence.

## Notes

Current/future decrypt failures already have workflow-level regression coverage to avoid the generic `Workspace setup failed` fallback. This finding is specifically about historical persisted failures and point-of-failure recovery: a returning user should not have to know to open Runtime Inspector to discover the actionable cause.
