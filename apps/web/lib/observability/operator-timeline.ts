// STUB — implementation to follow in green commit
// This file exists only to allow test imports to succeed and produce behavioral failures.

export type OperatorTimelineErrorKind =
  | "operator_timeline_invalid_event"
  | "operator_timeline_build_failed";

export class OperatorTimelineError extends Error {
  readonly kind: OperatorTimelineErrorKind;

  constructor(message: string, kind: OperatorTimelineErrorKind) {
    super(message);
    this.name = "OperatorTimelineError";
    this.kind = kind;
  }
}

export function buildOperatorTimeline(
  _events: unknown[],
  _workflowRuns: unknown[],
  _workflowRunSteps: unknown[],
  _workers: unknown[],
  _options?: { limit?: number; windowMs?: number },
): never[] {
  throw new OperatorTimelineError(
    "not implemented",
    "operator_timeline_build_failed",
  );
}
