import { z } from "zod";

// ---------------------------------------------------------------------------
// Single source of truth for workflow artifact enums.
//
// Redaction alignment note:
//   ARTIFACT_REDACTION_STATUSES intentionally reuses the same four values
//   ("pending" | "passed" | "failed" | "blocked") as the `redactionStatus`
//   field on sandboxBrowserRuns and backgroundAgentEvents in schema.ts. The
//   redaction.ts harness already treats keys named "artifact" /
//   "artifact_content" / "artifactContent" as high-sensitivity content
//   (ARTIFACT_CONTENT_KEYS). Enforcement wiring (#43) will use these statuses
//   to gate artifact delivery.
// ---------------------------------------------------------------------------

export const ARTIFACT_KINDS = [
  "research_packet",
  "spec",
  "receipt",
  "gate_report",
  "final_build_report",
] as const;

export const ARTIFACT_STATUSES = [
  "expected",
  "generating",
  "available",
  "superseded",
  "redacted",
  "failed",
  "missing",
  "archived",
] as const;

// Matches existing redactionStatus vocabulary in schema.ts (sandboxBrowserRuns,
// backgroundAgentEvents). "pending" = not yet reviewed, "passed" = no PII
// found, "failed" = PII detected, "blocked" = blocked pending review.
export const ARTIFACT_REDACTION_STATUSES = [
  "pending",
  "passed",
  "failed",
  "blocked",
] as const;

export type WorkflowArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type WorkflowArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export type WorkflowArtifactRedactionStatus =
  (typeof ARTIFACT_REDACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Zod schemas — the validated insert shape (subset of the full DB row).
// ---------------------------------------------------------------------------

export const workflowArtifactInsertSchema = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  status: z.enum(ARTIFACT_STATUSES).optional(),
  redactionStatus: z.enum(ARTIFACT_REDACTION_STATUSES).optional(),
  sourceLocation: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  createdByActor: z.string().nullable().optional(),
  workflowRunId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  chatId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  gateId: z.string().nullable().optional(),
});

export type WorkflowArtifactInsert = z.infer<
  typeof workflowArtifactInsertSchema
>;
