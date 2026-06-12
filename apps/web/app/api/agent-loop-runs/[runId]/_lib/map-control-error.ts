/**
 * Maps run-control errors to HTTP responses.
 *
 * The store functions (via run-controls.ts) throw with structured messages:
 *   - "Run <id> not found" → 404 (ownership miss or non-existent)
 *   - "Cannot pause/cancel/resume/retry run <id>: ..." → 409 illegal transition
 *
 * This helper centralises the mapping so each control route stays thin.
 */

/** Returns true if the error message indicates a "not found" / ownership miss. */
function isNotFoundError(message: string): boolean {
  return (
    message.includes("not found") ||
    (message.includes("Run ") && message.includes("not found"))
  );
}

/** Returns true if the error message indicates an illegal state transition. */
function isIllegalTransitionError(message: string): boolean {
  return (
    message.startsWith("Cannot pause") ||
    message.startsWith("Cannot cancel") ||
    message.startsWith("Cannot resume") ||
    message.startsWith("Cannot retry") ||
    message.includes("not in a pausable status") ||
    message.includes("not in a cancellable status") ||
    message.includes("not in paused status") ||
    message.includes("not in a retryable status") ||
    message.includes("missing currentNodeId")
  );
}

export function mapControlError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);

  if (isNotFoundError(message)) {
    return Response.json({ error: "Loop run not found" }, { status: 404 });
  }

  if (isIllegalTransitionError(message)) {
    return Response.json(
      {
        errorKind: "illegal_transition",
        message,
      },
      { status: 409 },
    );
  }

  // Unexpected error — re-throw to get a 500
  throw err;
}
