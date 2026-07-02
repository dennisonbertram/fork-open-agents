import type { GtmEvidenceRef } from "@/lib/gtm/types";

export type GtmResearchErrorKind =
  | "invalid_research_input"
  | "missing_required_citation"
  | "private_fact_unverified"
  | "cross_user_reference"
  | "persistence_failed";

export class GtmResearchError extends Error {
  readonly kind: GtmResearchErrorKind;

  constructor(kind: GtmResearchErrorKind, message: string) {
    super(message);
    this.name = "GtmResearchError";
    this.kind = kind;
  }
}

export type GtmResearchSignalKind =
  | "fit"
  | "pain"
  | "trigger"
  | "tech_stack"
  | "hiring"
  | "funding"
  | "contact_role"
  | "objection"
  | "timing";

export interface GtmResearchClaimInput {
  text: string;
  evidenceRefs?: GtmEvidenceRef[];
  privateFact?: boolean;
}

export interface GtmResearchBriefInput {
  accountName?: string | null;
  contactName?: string | null;
  claims: GtmResearchClaimInput[];
  openQuestions?: string[];
  nextSteps?: string[];
}

export interface GtmCitedClaim {
  text: string;
  evidenceRefs: GtmEvidenceRef[];
}

export interface GtmRejectedClaim {
  text: string;
  reason: "missing_required_citation" | "private_fact_unverified";
}

export interface GtmSignalCandidate {
  kind: GtmResearchSignalKind;
  summary: string;
  confidence: "high" | "medium" | "low" | "unknown";
  evidenceRefs: GtmEvidenceRef[];
  status: "draft";
}

export interface AccountBriefDraft {
  accountName?: string;
  contactName?: string;
  citedFacts: GtmCitedClaim[];
  unknownClaims: GtmRejectedClaim[];
  openQuestions: string[];
  nextSteps: string[];
  signalCandidates: GtmSignalCandidate[];
}

export interface CreateGtmResearchRunInput extends GtmResearchBriefInput {
  userId: string;
  requestId: string;
  accountId?: string | null;
  contactId?: string | null;
}

export interface CreateGtmResearchRunResult {
  runId: string;
  brief: AccountBriefDraft;
  signalIds: string[];
}
