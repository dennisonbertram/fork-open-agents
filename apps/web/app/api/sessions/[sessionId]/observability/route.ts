import { and, desc, eq } from "drizzle-orm";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { db } from "@/lib/db/client";
import { listArtifacts } from "@/lib/db/workflow-artifacts";
import { chatMessages, chats, workflowRuns } from "@/lib/db/schema";
import {
  extractManagedRuntimeWorkersFromMessages,
  summarizeManagedRuntimeDirectToolUseFromMessages,
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

  // Defensive: fetch artifacts for the session/chat, degrading to [] on failure
  // so a DB error does not break the entire observability response.
  let workflowArtifacts: Array<{
    id: string;
    kind: string;
    status: string;
    redactionStatus: string;
    createdByActor: string | null;
    createdAt: string;
    workflowRunId: string | null;
    // summary and sourceLocation are null unless redactionStatus === "passed" —
    // this is the server-side redaction gate. Raw content MUST NOT reach the
    // client payload for non-passed artifacts to prevent information leaks.
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
        // Server-side gate: only "passed" artifacts carry content in the response
        summary: isPassed ? (row.summary ?? null) : null,
        sourceLocation: isPassed ? (row.sourceLocation ?? null) : null,
      };
    });
  } catch {
    // Degrade gracefully — observability data is non-critical
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
    services,
    browserRuns,
    workflowArtifacts,
  });
}
