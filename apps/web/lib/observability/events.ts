import "server-only";

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  type NewSessionEvent,
  type SessionEvent,
  sessionEvents,
} from "@/lib/db/schema";
import { redactHarnessPayload } from "@/lib/harness/redaction";

type SessionEventSource = NewSessionEvent["source"];
type SessionEventActorType = NewSessionEvent["actorType"];
type SessionEventStatus = NewSessionEvent["status"];

export type RecordSessionEventInput = {
  sessionId: string;
  userId: string;
  source: SessionEventSource;
  actorType: SessionEventActorType;
  eventName: string;
  status: SessionEventStatus;
  chatId?: string | null;
  actorId?: string | null;
  summary?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  harnessRunId?: string | null;
  sandboxName?: string | null;
  managedRuntimeProfileRunId?: string | null;
  serviceId?: string | null;
  browserRunId?: string | null;
  payload?: unknown;
  redactionStatus?: NewSessionEvent["redactionStatus"];
};

export type SessionEventSnapshot = Omit<SessionEvent, "createdAt"> & {
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactSessionEventPayload(
  payload: unknown,
): Record<string, unknown> {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (isRecord(payload)) {
    return redactHarnessPayload(payload);
  }

  return redactHarnessPayload({ value: payload });
}

export function toSessionEventSnapshot(
  event: SessionEvent,
): SessionEventSnapshot {
  return {
    ...event,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function recordSessionEvent(
  input: RecordSessionEventInput,
): Promise<SessionEvent> {
  const [event] = await db
    .insert(sessionEvents)
    .values({
      id: nanoid(),
      sessionId: input.sessionId,
      chatId: input.chatId ?? null,
      userId: input.userId,
      source: input.source,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      eventName: input.eventName,
      status: input.status,
      summary: input.summary ?? null,
      requestId: input.requestId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      harnessRunId: input.harnessRunId ?? null,
      sandboxName: input.sandboxName ?? null,
      managedRuntimeProfileRunId: input.managedRuntimeProfileRunId ?? null,
      serviceId: input.serviceId ?? null,
      browserRunId: input.browserRunId ?? null,
      payload: redactSessionEventPayload(input.payload),
      redactionStatus: input.redactionStatus ?? "passed",
    })
    .returning();

  if (!event) {
    throw new Error("Failed to record session event");
  }

  return event;
}

export async function emitSessionEvent(
  input: RecordSessionEventInput,
): Promise<SessionEvent | null> {
  try {
    return await recordSessionEvent(input);
  } catch (error) {
    console.error("[observability] Failed to record session event:", error);
    return null;
  }
}

export async function listSessionEvents(params: {
  sessionId: string;
  chatId?: string | null;
  limit?: number;
}): Promise<SessionEvent[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const where =
    params.chatId == null
      ? eq(sessionEvents.sessionId, params.sessionId)
      : and(
          eq(sessionEvents.sessionId, params.sessionId),
          or(
            eq(sessionEvents.chatId, params.chatId),
            isNull(sessionEvents.chatId),
          ),
        );

  return db.query.sessionEvents.findMany({
    where,
    orderBy: [desc(sessionEvents.createdAt)],
    limit,
  });
}
