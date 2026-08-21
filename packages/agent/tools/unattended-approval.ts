import { getUnattended } from "./utils";

export type UnattendedApprovalDenial = {
  success: false;
  errorKind: "tool_policy_denied";
  reason: "unattended_approval_unavailable";
  error: string;
  // Optional passthrough fields so the denial stays assignable to each
  // gated tool's result union without breaking UI renderers that read
  // these properties off tool outputs.
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  path?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  content?: string;
};

export function isUnattendedRun(experimental_context: unknown): boolean {
  return getUnattended(experimental_context);
}

/**
 * Typed auto-deny for approval-gated calls in unattended runs. An approval
 * request with no human to answer wedges the worker until it times out or
 * kills the run; denying deterministically keeps the loop alive with a
 * machine-readable reason.
 */
export function unattendedApprovalDenial(
  toolName: string,
): UnattendedApprovalDenial {
  return {
    success: false,
    errorKind: "tool_policy_denied",
    reason: "unattended_approval_unavailable",
    error: `${toolName} requires human approval, but this run is unattended with no approver available. The call was denied instead of left pending.`,
  };
}
