import "server-only";

import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

/**
 * Canonical vocabulary for the ProfileRun state machine (#807/#808). One
 * mapping consumed by both runtime execution (MR-2) and every UI surface
 * (MR-6/MR-7) — reconciles schema.ts:541-543 (run status enum) with
 * schema.ts:29-32 (command observation status enum).
 */
export const MANAGED_RUNTIME_RUN_STATUSES = [
  "running",
  "passed",
  "failed",
  "blocked",
] as const;

export type ManagedRuntimeRunStatus =
  (typeof MANAGED_RUNTIME_RUN_STATUSES)[number];

export const MANAGED_RUNTIME_COMMAND_STATUSES = [
  "running",
  "passed",
  "failed",
  "skipped",
] as const;

export type ManagedRuntimeCommandStatus =
  (typeof MANAGED_RUNTIME_COMMAND_STATUSES)[number];

/**
 * Typed failure surfaces for a ProfileRun. Every fail-closed or
 * evidence-integrity gap in the epic (#807) maps to exactly one of these —
 * no ad hoc string errors.
 */
export const MANAGED_RUNTIME_ERROR_KINDS = [
  "profile_not_found",
  "setup_command_failed",
  "verification_failed",
  "setup_exec_error",
  "evidence_write_failed",
] as const;

export type ManagedRuntimeErrorKind =
  (typeof MANAGED_RUNTIME_ERROR_KINDS)[number];

const NEXT_ACTION_BY_ERROR_KIND: Record<ManagedRuntimeErrorKind, string> = {
  profile_not_found:
    "This profile no longer exists. Choose another profile or recreate it.",
  setup_command_failed:
    "Fix the failing setup command in the profile editor, then run setup again.",
  verification_failed:
    "Fix the failing verification command in the profile editor, then re-run verification.",
  setup_exec_error:
    "The setup command could not run in the sandbox. Check the sandbox status and try again.",
  evidence_write_failed:
    "Evidence for this run could not be saved. Re-run the profile to try recording evidence again.",
};

/**
 * Returns the fixed next-action copy for a given typed error kind. Copy is
 * reused across API responses and UI surfaces (see issue #808 section 4).
 */
export function nextActionFor(kind: ManagedRuntimeErrorKind): string {
  return NEXT_ACTION_BY_ERROR_KIND[kind];
}

/**
 * Deterministically rolls a list of command observations up into a single
 * run-level status:
 * - Any observation still "running" => the run is "running".
 * - Otherwise, any REQUIRED observation "failed" => the run is "failed".
 * - No observations at all => the run is "blocked" (nothing ran yet).
 * - Otherwise, any REQUIRED observation that did not pass (e.g. "skipped")
 *   => the run is "blocked" (a required command was not verified — it must
 *   never roll up to "passed"; Codex #825 P2).
 * - Otherwise every required observation passed (optional failures/skips do
 *   not fail the run) => the run is "passed".
 */
export function rollupFromObservations(
  observations: ManagedRuntimeCommandObservation[],
): ManagedRuntimeRunStatus {
  if (observations.length === 0) {
    return "blocked";
  }

  if (observations.some((observation) => observation.status === "running")) {
    return "running";
  }

  const isRequired = (observation: ManagedRuntimeCommandObservation) =>
    observation.required !== false;

  const hasRequiredFailure = observations.some(
    (observation) => observation.status === "failed" && isRequired(observation),
  );
  if (hasRequiredFailure) {
    return "failed";
  }

  // A required command that finished without passing (e.g. "skipped") means the
  // toolchain was not fully verified — this must not be reported as "passed".
  const hasUnverifiedRequired = observations.some(
    (observation) => observation.status !== "passed" && isRequired(observation),
  );
  if (hasUnverifiedRequired) {
    return "blocked";
  }

  return "passed";
}
