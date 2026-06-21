# Delegated Worker Cleanup And Recovery

Delegated worker runs persist cleanup status separately from worker work status.
This keeps completed evidence intact even when resource cleanup still needs a
follow-up.

## Cleanup Statuses

- `not_required`: no shared lock or isolated child resource needs cleanup.
- `pending`: the worker is still active and cleanup has not run yet.
- `succeeded`: terminal cleanup evidence was recorded, such as a shared writer
  lock release.
- `cleanup_required`: the worker reached a terminal or stale state but a
  resource still needs operator attention.
- `failed`: a cleanup attempt failed and should be retried or investigated.
- `recovered`: a previously stale or cleanup-required run has been reconciled.

## Operator Evidence

Persisted delegated worker runs include safe debugging fields:

- `cleanupStatus`
- `cleanupReasonCode`
- `cleanupReason`
- `cleanupResourceId`
- `cleanupAttemptCount`
- `cleanupAttemptedAt`
- `cleanupCompletedAt`
- `recoveredAt`

Do not store credentials, environment dumps, or raw provider tokens in cleanup
fields. Resource IDs should be backend IDs, workspace IDs, or lease/workspace
identifiers that are safe for operators to inspect.

## Manual Fallback For `cleanup_required`

1. Inspect the worker status, reason code, workspace mode, and completion packet.
2. If `workspaceMode` is `shared`, verify the shared writer lock state for the
   reported `cleanupResourceId` and rerun reconciliation after clearing stale
   ownership.
3. If `workspaceMode` is `isolated`, inspect the child workspace identified by
   `cleanupResourceId`. The current sandbox backend does not expose destructive
   child workspace cleanup, so the run is marked `cleanup_required` rather than
   silently deleting or hiding the resource.
4. Preserve completion packet evidence before retrying work. Cleanup recovery
   should not mutate the recorded worker result.
