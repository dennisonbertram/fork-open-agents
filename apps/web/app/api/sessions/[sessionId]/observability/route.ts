import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { db } from "@/lib/db/client";
import {
  chatMessages,
  chats,
  workflowRunSteps,
  workflowRuns,
} from "@/lib/db/schema";
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
import {
  buildOperatorTimeline,
  type TimelineEventRecorder,
} from "@/lib/observability/operator-timeline";
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

  // 7th parallel query: workflowRunSteps for all fetched workflow run IDs
  const workflowRunIds = workflows.map((w) => w.id);
  const steps =
    workflowRunIds.length > 0
      ? await db.query.workflowRunSteps.findMany({
          where: inArray(workflowRunSteps.workflowRunId, workflowRunIds),
          orderBy: [asc(workflowRunSteps.startedAt)],
          limit: 500,
        })
      : [];

  const workers = extractManagedRuntimeWorkersFromMessages(workerMessages);

  const workflowRunsJson = workflows.map((workflow) => ({
    ...workflow,
    startedAt: workflow.startedAt.toISOString(),
    finishedAt: workflow.finishedAt.toISOString(),
    createdAt: workflow.createdAt.toISOString(),
  }));

  const eventSnapshots = events.map(toSessionEventSnapshot);

  // Structured-logging recorder: emits observable events for operator-timeline
  // lifecycle so build success/failure and skipped entries are traceable in prod
  // logs. All calls are best-effort — recorder failures never break the route.
  // NOTE: a full session-event row per timeline build is intentionally out of
  // scope here to avoid write amplification on every observability GET request.
  const timelineRecorder: TimelineEventRecorder = (eventName, fields) => {
    if (eventName === "operator-timeline-build-failed") {
      console.warn(`[operator-timeline] ${eventName}`, fields);
    } else {
      console.info(`[operator-timeline] ${eventName}`, fields);
    }
  };

  let operatorTimeline: ReturnType<typeof buildOperatorTimeline> = [];
  try {
    operatorTimeline = buildOperatorTimeline(
      eventSnapshots,
      workflowRunsJson,
      steps,
      workers,
      undefined,
      timelineRecorder,
    );
  } catch (err) {
    console.error("[observability] buildOperatorTimeline failed:", err);
    // operatorTimeline stays []
  }

  return Response.json({
    runtimeMode: sessionContext.sessionRecord.runtimeMode,
    events: eventSnapshots,
    profileRuns: profileRuns.map(toManagedRuntimeProfileRunSnapshot),
    workflowRuns: workflowRunsJson,
    workers,
    directToolUse:
      summarizeManagedRuntimeDirectToolUseFromMessages(workerMessages),
    services,
    browserRuns,
    operatorTimeline,
  });
}
