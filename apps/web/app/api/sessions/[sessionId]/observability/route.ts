import { and, desc, eq } from "drizzle-orm";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { db } from "@/lib/db/client";
import { listGoalEvents, listGoals } from "@/lib/db/goal-ledger";
import { listArtifacts } from "@/lib/db/workflow-artifacts";
import { chatMessages, chats, workflowRuns } from "@/lib/db/schema";
import {
  extractManagedRuntimeWorkersFromMessages,
  summarizeManagedRuntimeDirectToolUseFromMessages,
  summarizeExternalToolUseFromMessages,
} from "@/lib/observability/managed-runtime-workers";
import {
  listManagedRuntimeProfileRuns,
  toManagedRuntimeProfileRunSnapshot,
} from "@/lib/observability/managed-runtime-profile-runs";
import {
  listSessionEvents,
  toSessionEventSnapshot,
} from "@/lib/observability/events";
import { listManagedBrowserRuns } from "@/lib/sandbox/runtime/browser-runs";
import { listManagedServices } from "@/lib/sandbox/runtime/service-launch";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function getBoundedLimit(value: string | null, fallback: number, max: number) {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), max)
    : fallback;
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  const eventLimit = getBoundedLimit(url.searchParams.get("limit"), 150, 500);

  const workflowWhere = chatId
    ? and(
        eq(workflowRuns.sessionId, sessionId),
        eq(workflowRuns.chatId, chatId),
      )
    : eq(workflowRuns.sessionId, sessionId);
  const [
    events,
    profileRuns,
    workflows,
    services,
    browserRuns,
    workerMessages,
  ] = await Promise.all([
    listSessionEvents({ sessionId, chatId, limit: eventLimit }),
    listManagedRuntimeProfileRuns({ sessionId, chatId, limit: 20 }),
    db.query.workflowRuns.findMany({
      where: workflowWhere,
      orderBy: [desc(workflowRuns.createdAt)],
      limit: 20,
    }),
    sessionContext.sessionRecord.runtimeMode === "managed_runtime"
      ? listManagedServices({ sessionId })
      : Promise.resolve([]),
    sessionContext.sessionRecord.runtimeMode === "managed_runtime"
      ? listManagedBrowserRuns({ sessionId, chatId, limit: 20 })
      : Promise.resolve([]),
    sessionContext.sessionRecord.runtimeMode === "managed_runtime" && chatId
      ? db
          .select({
            id: chatMessages.id,
            parts: chatMessages.parts,
            createdAt: chatMessages.createdAt,
          })
          .from(chatMessages)
          .innerJoin(chats, eq(chats.id, chatMessages.chatId))
          .where(
            and(
              eq(chats.sessionId, sessionId),
              eq(chatMessages.chatId, chatId),
              eq(chatMessages.role, "assistant"),
            ),
          )
          .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
          .limit(20)
      : Promise.resolve([]),
  ]);

  // Defensively query goal-ledger — a failure here must NOT break the rest of
  // the observability response. Append workflowGoals: [] on any error.
  let workflowGoals: Array<{
    id: string;
    objective: string;
    status: string;
    blockedReason: string | null;
    evidenceRefs: string[];
    createdAt: string;
    updatedAt: string;
    events: Array<{
      id: string;
      eventType: string;
      summary: string;
      sequence: number;
      payload?: Record<string, unknown>;
      createdAt: string;
    }>;
  }> = [];

  try {
    const goals = await listGoals({ sessionId, chatId: chatId ?? undefined });
    workflowGoals = await Promise.all(
      goals.map(async (goal) => {
        const goalEvents = await listGoalEvents(goal.id);
        return {
          id: goal.id,
          objective: goal.objective,
          status: goal.status,
          blockedReason: goal.blockedReason ?? null,
          evidenceRefs: goal.evidenceRefs,
          createdAt: goal.createdAt.toISOString(),
          updatedAt: goal.updatedAt.toISOString(),
          events: goalEvents.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            summary: event.summary,
            sequence: event.sequence,
            payload: event.payload,
            createdAt: event.createdAt.toISOString(),
          })),
        };
      }),
    );
  } catch {
    // Goal-ledger failure is non-fatal; surface empty array so the rest of
    // the observability response remains valid.
    workflowGoals = [];
  }

  let workflowArtifacts: Array<{
    id: string;
    kind: string;
    status: string;
    redactionStatus: string;
    createdByActor: string | null;
    createdAt: string;
    workflowRunId: string | null;
    summary: string | null;
    sourceLocation: string | null;
  }> = [];

  try {
    const artifactRows = await listArtifacts({
      sessionId,
      chatId: chatId ?? undefined,
    });
    workflowArtifacts = artifactRows.map((row) => {
      const isPassed = row.redactionStatus === "passed";
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        redactionStatus: row.redactionStatus,
        createdByActor: row.createdByActor ?? null,
        createdAt: row.createdAt.toISOString(),
        workflowRunId: row.workflowRunId ?? null,
        summary: isPassed ? (row.summary ?? null) : null,
        sourceLocation: isPassed ? (row.sourceLocation ?? null) : null,
      };
    });
  } catch {
    // Artifact lookup is non-fatal; observability should still render.
    workflowArtifacts = [];
  }

  return Response.json({
    runtimeMode: sessionContext.sessionRecord.runtimeMode,
    events: events.map(toSessionEventSnapshot),
    profileRuns: profileRuns.map(toManagedRuntimeProfileRunSnapshot),
    workflowRuns: workflows.map((workflow) => ({
      ...workflow,
      startedAt: workflow.startedAt.toISOString(),
      finishedAt: workflow.finishedAt.toISOString(),
      createdAt: workflow.createdAt.toISOString(),
    })),
    workers: extractManagedRuntimeWorkersFromMessages(workerMessages),
    directToolUse:
      summarizeManagedRuntimeDirectToolUseFromMessages(workerMessages),
    externalToolUse: summarizeExternalToolUseFromMessages(workerMessages),
    services,
    browserRuns,
    workflowGoals,
    workflowArtifacts,
  });
}
