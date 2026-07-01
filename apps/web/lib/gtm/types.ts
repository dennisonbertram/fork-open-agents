export const GTM_ERROR_KINDS = [
  "unauthenticated",
  "unauthorized",
  "invalid_input",
  "entity_not_found",
  "cross_user_reference",
  "duplicate_external_id",
  "redaction_failed",
  "ledger_append_failed",
  "persistence_failed",
  "invalid_review_window",
  "experiment_source_missing",
  "metric_source_unavailable",
  "qualitative_source_unavailable",
  "source_gap",
  "approval_required",
  "approval_denied",
  "dedup_failed",
  "learning_persistence_failed",
] as const;
export type GtmErrorKind = (typeof GTM_ERROR_KINDS)[number];

export const GTM_EVENT_NAMES = [
  "gtm.account.created",
  "gtm.contact.upserted",
  "gtm.signal.recorded",
  "gtm.experiment.created",
  "gtm.touchpoint.recorded",
  "gtm.insight.recorded",
  "gtm.agent_run.started",
  "gtm.agent_run.completed",
  "gtm.agent_run.failed",
  "gtm.approval.requested",
  "gtm.approval.decided",
  "gtm.call_brief.created",
  "gtm.call_notes.ingested",
  "gtm.call_debrief.extracted",
  "gtm.call_action.proposed",
  "gtm.call_action.approved",
  "gtm.call_action.rejected",
  "gtm.call_action.applied",
  "gtm.call_action.failed",
  "activation.watcher.scanned",
  "activation.signal.created",
  "activation.signal.deduped",
  "activation.issue_draft.created",
  "activation.issue_file.blocked_without_approval",
  "weekly_review.started",
  "weekly_review.experiment_summarized",
  "weekly_review.source_gap_detected",
  "weekly_review.learning_candidate_extracted",
  "weekly_review.learning_redaction_blocked",
  "weekly_review.learning_deduped",
  "weekly_review.learning_approval_requested",
  "weekly_review.learning_persisted",
  "weekly_review.completed",
  "weekly_review.failed",
] as const;
export type GtmEventName = (typeof GTM_EVENT_NAMES)[number];

export const GTM_EVENT_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "blocked",
  "info",
] as const;
export type GtmEventStatus = (typeof GTM_EVENT_STATUSES)[number];

export const GTM_EVENT_LEVELS = ["info", "warn", "error"] as const;
export type GtmEventLevel = (typeof GTM_EVENT_LEVELS)[number];

export const GTM_ENTITY_KINDS = [
  "account",
  "contact",
  "signal",
  "experiment",
  "touchpoint",
  "insight",
  "agent_run",
  "approval",
] as const;
export type GtmEntityKind = (typeof GTM_ENTITY_KINDS)[number];

export type GtmRedactionStatus = "redacted" | "not_required" | "blocked";

export type GtmEvidenceRef = {
  sourceType: "manual" | "crm" | "public_url" | "product" | "github" | "call";
  url?: string;
  recordId?: string;
  retrievedAt?: string;
  excerpt?: string;
};

export interface AppendGtmEventInput {
  userId: string;
  eventName: GtmEventName;
  entityKind: GtmEntityKind;
  entityId: string;
  status: GtmEventStatus;
  level?: GtmEventLevel;
  requestId: string;
  sessionId?: string | null;
  chatId?: string | null;
  workflowRunId?: string | null;
  gtmAgentRunId?: string | null;
  errorKind?: GtmErrorKind | null;
  payload?: Record<string, unknown>;
}

export function isGtmEventName(value: string): value is GtmEventName {
  return GTM_EVENT_NAMES.includes(value as GtmEventName);
}

export function isGtmEntityKind(value: string): value is GtmEntityKind {
  return GTM_ENTITY_KINDS.includes(value as GtmEntityKind);
}

export function isGtmEventStatus(value: string): value is GtmEventStatus {
  return GTM_EVENT_STATUSES.includes(value as GtmEventStatus);
}

export function isGtmEventLevel(value: string): value is GtmEventLevel {
  return GTM_EVENT_LEVELS.includes(value as GtmEventLevel);
}

export function isGtmErrorKind(value: string): value is GtmErrorKind {
  return GTM_ERROR_KINDS.includes(value as GtmErrorKind);
}

export class GtmError extends Error {
  readonly kind: GtmErrorKind;

  constructor(kind: GtmErrorKind, message: string) {
    super(message);
    this.name = "GtmError";
    this.kind = kind;
  }
}
