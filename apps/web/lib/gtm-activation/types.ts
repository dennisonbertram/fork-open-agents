import type { GtmEvidenceRef } from "@/lib/gtm/types";

export type GtmActivationErrorKind =
  | "invalid_signal_input"
  | "duplicate_signal"
  | "approval_required"
  | "persistence_failed";

export class GtmActivationError extends Error {
  readonly kind: GtmActivationErrorKind;

  constructor(kind: GtmActivationErrorKind, message: string) {
    super(message);
    this.name = "GtmActivationError";
    this.kind = kind;
  }
}

export type GtmActivationSignalType =
  | "github_not_installed"
  | "no_first_session"
  | "repeated_session_failure"
  | "explicit_objection"
  | "product_request";

export type GtmActivationSeverity = "low" | "medium" | "high";

export interface GtmActivationSourceInput {
  targetUserHash: string;
  signedUpAt?: string | null;
  githubInstalled?: boolean;
  sessionCount?: number;
  failureCount?: number;
  objectionText?: string | null;
  featureRequestText?: string | null;
  evidenceRefs?: GtmEvidenceRef[];
}

export interface GtmActivationSignalCandidate {
  signalType: GtmActivationSignalType;
  severity: GtmActivationSeverity;
  targetUserHash: string;
  summary: string;
  suggestedIntervention: string;
  draftIssue: {
    title: string;
    body: string;
  };
  evidenceRefs: GtmEvidenceRef[];
  dedupSignature: string;
}

export interface RunGtmActivationWatcherInput {
  userId: string;
  requestId: string;
  candidates: GtmActivationSourceInput[];
}

export interface RunGtmActivationWatcherResult {
  runId: string;
  signalIds: string[];
  approvalIds: string[];
  dedupedCount: number;
}

export interface GtmActivationQueueItem {
  signalId: string;
  signalType: string;
  severity: string;
  summary: string;
  evidenceRefs: GtmEvidenceRef[];
  metadata: Record<string, unknown>;
  updatedAt: Date;
}
