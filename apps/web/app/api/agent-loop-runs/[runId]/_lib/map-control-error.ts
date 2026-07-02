/**
 * Maps run-control errors to HTTP responses.
 *
 * The store functions (pauseLoopRun, cancelLoopRun, resumeLoopRun) and
 * retryCurrentStep now throw RunControlError with a typed kind discriminator:
 *   - kind="not_found"          → 404 (run missing OR not owned — no existence leak)
 *   - kind="illegal_transition" → 409 (run exists, owned, wrong status)
 *
 * resumeLoopRun and retryCurrentStep additionally throw DispatchFailedError
 * (issue #763 — "no false success") when the status transition succeeded but
 * the workflow dispatch itself threw:
 *   - DispatchFailedError → 502 {success:false, errorKind:"dispatch_failed"}
 *     (the run row has already been marked failed by the caller)
 *
 * This mapper switches on the typed kind rather than fragile string matching,
 * eliminating the class of bugs where a non-owned run could be misclassified
 * as 409 (which would imply the run EXISTS — an existence leak).
 *
 * This helper centralises the mapping so each control route stays thin.
 */

import {
  DispatchFailedError,
  RunControlError,
} from "@/lib/agent-loops/run-controls-error";

export function mapControlError(err: unknown): Response {
  if (err instanceof DispatchFailedError) {
    return Response.json(
      {
        success: false,
        errorKind: "dispatch_failed",
        message: err.message,
      },
      { status: 502 },
    );
  }

  if (err instanceof RunControlError) {
    if (err.kind === "not_found") {
      return Response.json({ error: "Loop run not found" }, { status: 404 });
    }

    // kind === "illegal_transition"
    return Response.json(
      {
        errorKind: "illegal_transition",
        message: err.message,
      },
      { status: 409 },
    );
  }

  // Unexpected error — re-throw to get a 500
  throw err;
}
