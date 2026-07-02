/**
 * Typed error for control-plane dispatch failures (issue #763 — "no false
 * success").
 *
 * Thrown when a control-plane action (resume, retry, or initial manual
 * dispatch) transitions the run's status successfully but the subsequent
 * `start()` workflow dispatch throws.
 *
 * Contract: the caller must NOT report success to the user in this case. The
 * run row is marked `errorKind: "dispatch_failed"` + `status: "failed"`
 * before this error is thrown, so the run page shows the real (failed)
 * state. API routes map this to a 502 response with
 * `{ success: false, errorKind: "dispatch_failed" }`.
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
