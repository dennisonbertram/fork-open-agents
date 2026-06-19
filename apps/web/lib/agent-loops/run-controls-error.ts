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
