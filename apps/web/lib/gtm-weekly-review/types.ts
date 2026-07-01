import type { GtmEvidenceRef } from "@/lib/gtm/types";

export type GtmWeeklyReviewErrorKind =
  | "invalid_review_window"
  | "experiment_source_missing"
  | "metric_source_unavailable"
  | "qualitative_source_unavailable"
  | "source_gap"
  | "redaction_failed"
  | "approval_required"
  | "approval_denied"
  | "dedup_failed"
  | "learning_persistence_failed";

export class GtmWeeklyReviewError extends Error {
  readonly kind: GtmWeeklyReviewErrorKind;

  constructor(kind: GtmWeeklyReviewErrorKind, message: string) {
    super(message);
    this.name = "GtmWeeklyReviewError";
    this.kind = kind;
  }
}

export type GtmWeeklyMetricValue = string | number | boolean | null;

export interface GtmWeeklyReviewApprovalInput {
  candidateKey: string;
  decision: "approved" | "denied" | "merge";
}

export interface RunGtmWeeklyReviewInput {
  userId: string;
  requestId: string;
  weekStart: string;
  weekEnd: string;
  approvals?: GtmWeeklyReviewApprovalInput[];
}

export interface GtmWeeklyExperimentSummary {
  experimentId: string;
  title: string;
  hypothesis: string;
  channel: string;
  owner: string | null;
  metricSummary: Array<{
    key: string;
    value: GtmWeeklyMetricValue;
  }>;
  qualitativeSignals: string[];
  evidenceRefs: GtmEvidenceRef[];
}

export interface GtmWeeklySourceGap {
  experimentId: string;
  sourceKind: "metrics" | "qualitative" | "evidence" | "redaction";
  errorKind: GtmWeeklyReviewErrorKind;
  message: string;
}

export interface GtmWeeklyNextBet {
  title: string;
  rationale: string;
  confidence: "high" | "medium" | "low" | "unknown";
  evidenceRefs: GtmEvidenceRef[];
}

export interface GtmWeeklyLearningCandidate {
  candidateKey: string;
  experimentId: string;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low" | "unknown";
  evidenceRefs: GtmEvidenceRef[];
  redactionStatus: "redacted" | "blocked";
  approvalStatus: "pending" | "approved" | "denied" | "merged";
  dedupSignature: string;
  approvalId?: string;
  learningId?: string;
  existingLearningId?: string;
}

export interface RunGtmWeeklyReviewResult {
  reviewRunId: string;
  status: "completed" | "partial" | "blocked";
  experimentSummaries: GtmWeeklyExperimentSummary[];
  sourceGaps: GtmWeeklySourceGap[];
  nextBets: GtmWeeklyNextBet[];
  learningCandidates: GtmWeeklyLearningCandidate[];
  approvalIds: string[];
  persistedLearningIds: string[];
  dedupedCount: number;
}

export interface GtmLearningContextItem {
  learningId: string;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low" | "unknown";
  sourceId: string | null;
  evidenceRefs: GtmEvidenceRef[];
  updatedAt: Date;
}
