import type { SharedWriterLeaseResult } from "./shared-writer-lease";

export class SharedWriterLeaseConflictError extends Error {
  readonly code = "shared_writer_already_active";
  readonly lease: Extract<SharedWriterLeaseResult, { status: "denied" }>;

  constructor(lease: Extract<SharedWriterLeaseResult, { status: "denied" }>) {
    super(
      `shared_writer_lock_denied: workspace ${lease.workspaceId} already has active writer ${lease.activeWorkerId}. Worker was not started.`,
    );
    this.name = "SharedWriterLeaseConflictError";
    this.lease = lease;
  }
}
