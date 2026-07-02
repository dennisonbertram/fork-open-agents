/**
 * Typed error for run-control state-machine violations (M1-08 control plane).
 *
 * kind discriminator:
 *   "not_found"          — run does not exist OR is not owned by the caller.
 *                          Both cases are indistinguishable by design (no-leak
 *                          contract: a non-owned run must look like a missing run).
 *   "illegal_transition" — run exists, caller owns it, but its current status
 *                          does not permit the requested operation.
 *
 * Mirrors the WorkflowCatalogError pattern in lib/workflows/catalog.ts.
 */

export type RunControlErrorKind = "not_found" | "illegal_transition";

export class RunControlError extends Error {
  readonly kind: RunControlErrorKind;

  constructor(kind: RunControlErrorKind, message: string) {
    super(message);
    this.name = "RunControlError";
    this.kind = kind;
  }
}

/**
 * Thrown when a control-plane action (resume, retry, or initial manual
 * dispatch) transitions the run's status successfully but the subsequent
 * `start()` workflow dispatch throws.
 *
 * Contract (issue #763 — "no false success"): the caller must NOT report
 * success to the user in this case. The run row is marked `errorKind:
 * "dispatch_failed"` + `status: "failed"` before this error is thrown, so
 * the run page shows the real (failed) state. API routes map this to a 502
 * response with `{ success: false, errorKind: "dispatch_failed" }`.
 */
export class DispatchFailedError extends Error {
  readonly errorKind = "dispatch_failed" as const;
  readonly runId: string;

  constructor(runId: string, message: string) {
    super(message);
    this.name = "DispatchFailedError";
    this.runId = runId;
  }
}
