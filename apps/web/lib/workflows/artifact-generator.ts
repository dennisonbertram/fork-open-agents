"use step";

import { redactHarnessValue } from "@/lib/harness/redaction";
import type { WorkflowArtifactInsert } from "@/lib/workflows/artifacts";

// ---------------------------------------------------------------------------
// recordWorkflowArtifactBestEffort
//
// Defensive "use step" wrapper that creates a workflow artifact via
// createArtifact.  A failure to write an artifact MUST NOT crash the
// workflow/chat turn, so all errors are caught, logged, and swallowed.
//
// Returns the created artifact id on success, or null on any failure.
// ---------------------------------------------------------------------------

export async function recordWorkflowArtifactBestEffort(
  input: WorkflowArtifactInsert,
): Promise<string | null> {
  "use step";

  try {
    const { createArtifact } = await import("@/lib/db/workflow-artifacts");
    const artifact = await createArtifact(input);
    return artifact.id;
  } catch (error: unknown) {
    console.error(
      "[artifact-generator] Failed to write artifact (best-effort, ignoring):",
      error,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildArtifactInputs
//
// Given the workflow context, produces the WorkflowArtifactInsert inputs for
// a research_packet and a spec artifact.
//
// Summary derivation:
//   - Taken from the user's objective text (last user message text).
//   - Passed through redactHarnessValue to strip secrets / tokens.
//   - Truncated to 500 chars to keep DB rows small.
//
// Status: "available" — the run completed before this point is called;
//   the artifacts represent the research/spec context that guided the run.
//
// goalId / gateId: null — those rows aren't linked in this slice
//   (best-effort / nullable, documented here and in assumptions).
// ---------------------------------------------------------------------------

export type ArtifactInputContext = {
  workflowRunId: string;
  sessionId: string;
  chatId: string;
  userId: string;
  objectiveText: string;
};

const MAX_SUMMARY_LENGTH = 500;

function buildRedactedSummary(objectiveText: string): string {
  const redacted = redactHarnessValue(objectiveText);
  return (typeof redacted === "string" ? redacted : String(redacted)).slice(
    0,
    MAX_SUMMARY_LENGTH,
  );
}

export function buildArtifactInputs(
  ctx: ArtifactInputContext,
): WorkflowArtifactInsert[] {
  const summary = buildRedactedSummary(ctx.objectiveText);

  const shared: Omit<WorkflowArtifactInsert, "kind" | "sourceLocation"> = {
    status: "available",
    redactionStatus: "pending",
    summary,
    createdByActor: "workflow",
    workflowRunId: ctx.workflowRunId,
    sessionId: ctx.sessionId,
    chatId: ctx.chatId,
    goalId: null,
    gateId: null,
  };

  return [
    {
      ...shared,
      kind: "research_packet",
      sourceLocation: `workflow-run/${ctx.workflowRunId}/research-packet`,
    },
    {
      ...shared,
      kind: "spec",
      sourceLocation: `workflow-run/${ctx.workflowRunId}/spec`,
    },
  ];
}
