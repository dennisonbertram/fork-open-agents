import {
  type AppendGtmEventInput,
  GtmError,
  isGtmEntityKind,
  isGtmErrorKind,
  isGtmEventLevel,
  isGtmEventName,
  isGtmEventStatus,
} from "./types";
import { redactGtmPayload } from "./redaction";
import type { GtmEvent, NewGtmEvent } from "@/lib/db/schema";

export type GtmEventInsert = Omit<NewGtmEvent, "createdAt">;

export interface GtmEventWriter {
  insertEvent(values: GtmEventInsert): Promise<GtmEvent | null>;
}

export function buildGtmEventInsert(
  input: AppendGtmEventInput,
): GtmEventInsert {
  if (
    !input.userId.trim() ||
    !input.requestId.trim() ||
    !input.entityId.trim() ||
    !isGtmEventName(input.eventName) ||
    !isGtmEntityKind(input.entityKind) ||
    !isGtmEventStatus(input.status) ||
    (input.level !== undefined && !isGtmEventLevel(input.level)) ||
    (input.errorKind !== undefined &&
      input.errorKind !== null &&
      !isGtmErrorKind(input.errorKind))
  ) {
    throw new GtmError("invalid_input", "GTM ledger event input is invalid.");
  }

  const payload = redactGtmPayload(input.payload ?? {});

  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    eventName: input.eventName,
    entityKind: input.entityKind,
    entityId: input.entityId,
    status: input.status,
    level: input.level ?? "info",
    requestId: input.requestId,
    sessionId: input.sessionId ?? null,
    chatId: input.chatId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    gtmAgentRunId: input.gtmAgentRunId ?? null,
    errorKind: input.errorKind ?? null,
    payload,
    redactionStatus:
      Object.keys(payload).length > 0 ? "redacted" : "not_required",
  };
}

export async function appendGtmEvent(
  writer: GtmEventWriter,
  input: AppendGtmEventInput,
): Promise<GtmEvent> {
  const row = await writer.insertEvent(buildGtmEventInsert(input));
  if (!row) {
    throw new GtmError("ledger_append_failed", "GTM ledger append failed.");
  }

  return row;
}
