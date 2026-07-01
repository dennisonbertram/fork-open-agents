import type { GtmEvidenceRef } from "@/lib/gtm/types";

export type GtmCallErrorKind =
  | "invalid_call_input"
  | "transcript_too_large"
  | "cross_user_reference"
  | "persistence_failed";

export class GtmCallError extends Error {
  readonly kind: GtmCallErrorKind;

  constructor(kind: GtmCallErrorKind, message: string) {
    super(message);
    this.name = "GtmCallError";
    this.kind = kind;
  }
}

export interface CreateGtmCallPrepInput {
  userId: string;
  requestId: string;
  accountId?: string | null;
  contactId?: string | null;
  founderObjective: string;
  knownContext?: string[];
  openLoops?: string[];
  desiredOutcome?: string | null;
  evidenceRefs?: GtmEvidenceRef[];
}

export interface GtmCallBrief {
  objective: string;
  conciseBrief: string;
  risks: string[];
  openLoops: string[];
  suggestedQuestions: string[];
  desiredOutcome?: string;
  sourceCount: number;
}

export interface CreateGtmCallPrepResult {
  callId: string;
  runId: string;
  brief: GtmCallBrief;
}

export interface CreateGtmCallDebriefInput {
  userId: string;
  requestId: string;
  accountId?: string | null;
  contactId?: string | null;
  callId?: string | null;
  notes: string;
  attendees?: string[];
  evidenceRefs?: GtmEvidenceRef[];
}

export interface GtmCallNextStep {
  summary: string;
  owner: "founder" | "customer" | "unknown";
  dueDate?: string;
}

export interface GtmCallProposedAction {
  actionKind: "follow_up_draft" | "gtm_record_update";
  summary: string;
  targetKind: "touchpoint" | "account" | "contact" | "insight";
}

export interface GtmCallDebrief {
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  attendees: string[];
  nextSteps: GtmCallNextStep[];
  objections: string[];
  productAsks: string[];
  followUpDraft: {
    subject: string;
    bodyPreview: string;
  };
  proposedActions: GtmCallProposedAction[];
}

export interface CreateGtmCallDebriefResult {
  callId: string;
  runId: string;
  debrief: GtmCallDebrief;
  insightIds: string[];
  approvalIds: string[];
}
