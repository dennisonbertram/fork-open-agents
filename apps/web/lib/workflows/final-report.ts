"use step";

import { redactHarnessValue } from "@/lib/harness/redaction";
import type {
  WorkflowArtifactInsert,
  WorkflowArtifactStatus,
} from "@/lib/workflows/artifacts";

// ---------------------------------------------------------------------------
// FinalReportContext
//
// The shared context passed into buildReceiptInputs and buildFinalReportInputs.
// ---------------------------------------------------------------------------

export type FinalReportContext = {
  workflowRunId: string;
  sessionId: string;
  chatId: string;
  userId: string;
  /** The terminal status of the workflow run (completed / failed / aborted). */
  workflowStatus: string;
  /** Raw objective text from the user; will be redacted + truncated for summaries. */
  objectiveText: string;
};

// ---------------------------------------------------------------------------
// decideFinalReportStatus — PURE, testable evidence-gating function
//
// Evidence-gating rule:
//   - A completed run WITH required evidence  → "available"
//   - A completed run WITHOUT required evidence → "missing"
//     (evidence required = research_packet + spec artifacts exist for this run)
//   - Any failed or aborted run               → "failed"
//     (the report cannot be produced for an unsuccessful run)
//
// The "blocked" status does not exist in ARTIFACT_STATUSES; "missing" is the
// closest valid status for "evidence required but not present", and "failed"
// covers non-successful runs.  These choices are documented in assumptions.
// ---------------------------------------------------------------------------

export function decideFinalReportStatus({
  workflowStatus,
  hasRequiredEvidence,
}: {
  workflowStatus: string;
  hasRequiredEvidence: boolean;
}): WorkflowArtifactStatus {
  if (workflowStatus !== "completed") {
    return "failed";
  }
  return hasRequiredEvidence ? "available" : "missing";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MAX_SUMMARY_LENGTH = 500;

function buildRedactedSummary(text: string): string {
  const redacted = redactHarnessValue(text);
  return (typeof redacted === "string" ? redacted : String(redacted)).slice(
    0,
    MAX_SUMMARY_LENGTH,
  );
}

// ---------------------------------------------------------------------------
// buildReceiptInputs
//
// Produces a WorkflowArtifactInsert for a "receipt" artifact.
//
// A receipt is always "available" — it records that a run occurred (regardless
// of outcome).  Summary = redacted + truncated description of the run outcome.
// ---------------------------------------------------------------------------

export function buildReceiptInputs(
  ctx: FinalReportContext,
): WorkflowArtifactInsert {
  const rawSummary = `Workflow run ${ctx.workflowRunId} finished with status: ${ctx.workflowStatus}. Objective: ${ctx.objectiveText}`;
  const summary = buildRedactedSummary(rawSummary);

  return {
    kind: "receipt",
    status: "available",
    redactionStatus: "pending",
    sourceLocation: `workflow-run/${ctx.workflowRunId}/receipt`,
    summary,
    createdByActor: "workflow",
    workflowRunId: ctx.workflowRunId,
    sessionId: ctx.sessionId,
    chatId: ctx.chatId,
    goalId: null,
    gateId: null,
  };
}

// ---------------------------------------------------------------------------
// buildFinalReportInputs
//
// Produces a WorkflowArtifactInsert for a "final_build_report" artifact.
//
// Evidence-gating: the status is determined by decideFinalReportStatus().
// If evidence is missing, the summary notes this.
// ---------------------------------------------------------------------------

export function buildFinalReportInputs(
  ctx: FinalReportContext,
  { hasRequiredEvidence }: { hasRequiredEvidence: boolean },
): WorkflowArtifactInsert {
  const status = decideFinalReportStatus({
    workflowStatus: ctx.workflowStatus,
    hasRequiredEvidence,
  });

  const rawSummary =
    status === "missing"
      ? `Final build report for run ${ctx.workflowRunId} is unavailable: required evidence (research_packet/spec artifacts) is missing.`
      : status === "failed"
        ? `Final build report for run ${ctx.workflowRunId} could not be produced: workflow ended with status ${ctx.workflowStatus}.`
        : `Final build report for run ${ctx.workflowRunId} (status: ${ctx.workflowStatus}). Objective: ${ctx.objectiveText}`;

  const summary = buildRedactedSummary(rawSummary);

  return {
    kind: "final_build_report",
    status,
    redactionStatus: "pending",
    sourceLocation: `workflow-run/${ctx.workflowRunId}/final-build-report`,
    summary,
    createdByActor: "workflow",
    workflowRunId: ctx.workflowRunId,
    sessionId: ctx.sessionId,
    chatId: ctx.chatId,
    goalId: null,
    gateId: null,
  };
}
