import { and, desc, eq } from "drizzle-orm";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
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
  const [events, profileRuns, workflows, services, browserRuns] =
    await Promise.all([
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
    ]);

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
    services,
    browserRuns,
  });
}
