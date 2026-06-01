"use step";

import type { WorkflowArtifactInsert, WorkflowArtifactStatus } from "@/lib/workflows/artifacts";

// Stub — implementation not yet written (red phase)

export type FinalReportContext = {
  workflowRunId: string;
  sessionId: string;
  chatId: string;
  userId: string;
  workflowStatus: string;
  objectiveText: string;
};

export function decideFinalReportStatus(_params: {
  workflowStatus: string;
  hasRequiredEvidence: boolean;
}): WorkflowArtifactStatus {
  throw new Error("Not implemented");
}

export function buildReceiptInputs(
  _ctx: FinalReportContext,
): WorkflowArtifactInsert {
  throw new Error("Not implemented");
}

export function buildFinalReportInputs(
  _ctx: FinalReportContext,
  _opts: { hasRequiredEvidence: boolean },
): WorkflowArtifactInsert {
  throw new Error("Not implemented");
}
