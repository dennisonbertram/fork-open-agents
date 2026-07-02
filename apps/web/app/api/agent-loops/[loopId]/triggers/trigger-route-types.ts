/**
 * Loop trigger API — response types (#762)
 *
 * Kept in its own colocated module rather than extending
 * app/api/agent-loops/types.ts — that file is touched by a separate wave-2
 * PR and this ticket's spec asks for a new file to avoid a merge conflict /
 * shape drift between the two changes.
 */
import type { BackgroundAgentTrigger } from "@/lib/db/schema";

/** A full loop trigger row enriched with UI-ready fields (#762). */
export type LoopTriggerWithSchedule = BackgroundAgentTrigger & {
  /** Plain-language rendering of `schedule`, always UTC-labeled. "" when no schedule. */
  humanizedSchedule: string;
};

/**
 * The minimal loop-trigger projection returned by listTriggersForLoop,
 * enriched with the humanized schedule (#762). GET returns this narrower
 * shape — it never exposes webhookSecretHash or other agent-trigger-only
 * fields.
 */
export type LoopTriggerSummaryWithSchedule = Pick<
  BackgroundAgentTrigger,
  | "id"
  | "kind"
  | "status"
  | "conditions"
  | "schedule"
  | "nextRunAt"
  | "createdAt"
> & {
  humanizedSchedule: string;
};

export type CreateLoopTriggerResponse = {
  trigger: LoopTriggerWithSchedule;
};

export type ListLoopTriggersResponse = {
  triggers: LoopTriggerSummaryWithSchedule[];
};

export type UpdateLoopTriggerResponse = {
  trigger: LoopTriggerWithSchedule;
};

export type DeleteLoopTriggerResponse = {
  success: true;
};

/** Standard error response shape for the loop-trigger routes. */
export type LoopTriggerErrorResponse = {
  errorKind: "trigger_invalid" | "loop_not_found" | "feature_disabled";
  message: string;
  errors?: { path: string; message: string }[];
};
