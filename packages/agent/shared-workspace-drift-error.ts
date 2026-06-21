import type { SharedWorkspaceDriftCheck } from "./shared-workspace-drift";

export class SharedWorkspaceDriftError extends Error {
  constructor(readonly result: SharedWorkspaceDriftCheck) {
    super(
      `workspace_drift_detected: ${result.reason}. Worker stopped before accepting shared workspace output.`,
    );
    this.name = "SharedWorkspaceDriftError";
  }
}
