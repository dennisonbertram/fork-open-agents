import { asc, eq, inArray } from "drizzle-orm";
import type {
  WebAgentResponseTimeline,
  WebAgentResponseTimelineCategory,
  WebAgentResponseTimelineSegment,
  WebAgentUIMessage,
} from "@/app/types";
import { db } from "./client";
import {
  chatMessages,
  sessionEvents,
  workflowRuns,
  workflowRunSteps,
} from "./schema";

type ChatMessageRow = Pick<
  typeof chatMessages.$inferSelect,
  "id" | "role" | "createdAt" | "parts"
>;

type WorkflowRunRow = typeof workflowRuns.$inferSelect;
type WorkflowRunStepRow = typeof workflowRunSteps.$inferSelect;
type SessionEventRow = typeof sessionEvents.$inferSelect;

function durationMs(startedAt: Date, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function addSegment(
  segments: WebAgentResponseTimelineSegment[],
  params: {
    id: string;
    label: string;
    category: WebAgentResponseTimelineCategory;
    startedAt: Date;
    finishedAt: Date;
    detail?: string;
    measured?: boolean;
  },
) {
  const segmentDurationMs = durationMs(params.startedAt, params.finishedAt);
  if (segmentDurationMs <= 0) {
    return;
  }

  segments.push({
    id: params.id,
    label: params.label,
    category: params.category,
    startedAt: params.startedAt.toISOString(),
    finishedAt: params.finishedAt.toISOString(),
    durationMs: segmentDurationMs,
    detail: params.detail,
    measured: params.measured ?? true,
  });
}

function eventTime(
  events: SessionEventRow[],
  eventName: string,
): Date | undefined {
  return events.find((event) => event.eventName === eventName)?.createdAt;
}

function thirdPartyLabel(eventName: string): string {
  if (eventName.startsWith("github.")) {
    return "GitHub provider";
  }
  if (eventName.startsWith("composio.")) {
    return "Composio provider";
  }
  if (eventName.startsWith("vercel.")) {
    return "Vercel provider";
  }
  return "Third-party provider";
}

function isThirdPartyEvent(eventName: string): boolean {
  return (
    eventName.startsWith("github.") ||
    eventName.startsWith("composio.") ||
    eventName.startsWith("vercel.")
  );
}

function buildTimeline(
  run: WorkflowRunRow,
  steps: WorkflowRunStepRow[],
  events: SessionEventRow[],
): WebAgentResponseTimeline {
  const sortedEvents = events.toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const sortedSteps = steps.toSorted((a, b) => a.stepNumber - b.stepNumber);
  const segments: WebAgentResponseTimelineSegment[] = [];
  const workflowStartedAt = eventTime(sortedEvents, "workflow.started");
  const runtimeResolvedAt = eventTime(
    sortedEvents,
    "workflow.runtime.resolved",
  );
  const firstStepStartedAt = sortedSteps[0]?.startedAt;

  if (workflowStartedAt) {
    addSegment(segments, {
      id: `${run.id}:database:start`,
      label: "Database",
      category: "database",
      startedAt: run.startedAt,
      finishedAt: workflowStartedAt,
      detail: "Request accepted, message/run state persisted, workflow queued.",
    });
  }

  if (workflowStartedAt && runtimeResolvedAt) {
    addSegment(segments, {
      id: `${run.id}:system:runtime`,
      label: "Runtime",
      category: "system",
      startedAt: workflowStartedAt,
      finishedAt: runtimeResolvedAt,
      detail:
        "Session runtime, sandbox context, skills, and model route resolved.",
    });
  }

  if (runtimeResolvedAt && firstStepStartedAt) {
    addSegment(segments, {
      id: `${run.id}:system:agent-setup`,
      label: "Agent setup",
      category: "system",
      startedAt: runtimeResolvedAt,
      finishedAt: firstStepStartedAt,
      detail: "Agent loop setup before the first model step.",
    });
  }

  for (const step of sortedSteps) {
    const thirdPartyEvents = sortedEvents.filter(
      (event) =>
        isThirdPartyEvent(event.eventName) &&
        event.createdAt >= step.startedAt &&
        event.createdAt <= step.finishedAt,
    );
    let cursor = step.startedAt;

    for (const event of thirdPartyEvents) {
      addSegment(segments, {
        id: `${run.id}:third-party:${event.id}`,
        label: thirdPartyLabel(event.eventName),
        category: "third_party",
        startedAt: cursor,
        finishedAt: event.createdAt,
        detail: `${event.summary ?? event.eventName} This span is inferred from event timing.`,
        measured: false,
      });
      cursor = event.createdAt;
    }

    addSegment(segments, {
      id: `${run.id}:inference:${step.stepNumber}`,
      label: `Model step ${step.stepNumber}`,
      category: "inference",
      startedAt: cursor,
      finishedAt: step.finishedAt,
      detail:
        step.finishReason || step.rawFinishReason
          ? `Finished with ${step.finishReason ?? "unknown"} (${step.rawFinishReason ?? "raw unknown"}).`
          : "Measured model step. Tool execution within this step is included until per-tool spans are recorded.",
    });
  }

  const lastStepFinishedAt = sortedSteps.at(-1)?.finishedAt;
  if (lastStepFinishedAt) {
    addSegment(segments, {
      id: `${run.id}:database:finish`,
      label: "Persist",
      category: "database",
      startedAt: lastStepFinishedAt,
      finishedAt: run.finishedAt,
      detail:
        "Assistant message, usage, run metadata, and final stream state persisted.",
    });
  }

  if (segments.length === 0) {
    addSegment(segments, {
      id: `${run.id}:system:total`,
      label: "Workflow",
      category: "system",
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      detail: "Only total run timing was recorded for this response.",
    });
  }

  return {
    workflowRunId: run.id,
    status: run.status,
    totalDurationMs: run.totalDurationMs,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    segments,
  };
}

function findRunForAssistantMessage(
  message: ChatMessageRow,
  previousMessage: ChatMessageRow | undefined,
  runs: WorkflowRunRow[],
): WorkflowRunRow | undefined {
  if (!previousMessage || previousMessage.role !== "user") {
    return undefined;
  }

  const userSentAt = previousMessage.createdAt.getTime();
  const assistantPersistedAt = message.createdAt.getTime();
  return runs.find((run) => {
    const runStartedAt = run.startedAt.getTime();
    return runStartedAt >= userSentAt && runStartedAt <= assistantPersistedAt;
  });
}

export async function getChatResponseTimelineMap(
  chatId: string,
): Promise<Map<string, WebAgentResponseTimeline>> {
  const [messages, runs] = await Promise.all([
    db.query.chatMessages.findMany({
      where: eq(chatMessages.chatId, chatId),
      orderBy: [chatMessages.createdAt, chatMessages.id],
    }),
    db.query.workflowRuns.findMany({
      where: eq(workflowRuns.chatId, chatId),
      orderBy: [workflowRuns.startedAt, workflowRuns.id],
    }),
  ]);

  if (runs.length === 0) {
    return new Map();
  }

  const runIds = runs.map((run) => run.id);
  const [steps, events] = await Promise.all([
    db.query.workflowRunSteps.findMany({
      where: inArray(workflowRunSteps.workflowRunId, runIds),
      orderBy: [workflowRunSteps.workflowRunId, workflowRunSteps.stepNumber],
    }),
    db.query.sessionEvents.findMany({
      where: inArray(sessionEvents.workflowRunId, runIds),
      orderBy: [asc(sessionEvents.createdAt), asc(sessionEvents.id)],
    }),
  ]);

  const stepsByRunId = new Map<string, WorkflowRunStepRow[]>();
  for (const step of steps) {
    const runSteps = stepsByRunId.get(step.workflowRunId) ?? [];
    runSteps.push(step);
    stepsByRunId.set(step.workflowRunId, runSteps);
  }

  const eventsByRunId = new Map<string, SessionEventRow[]>();
  for (const event of events) {
    if (!event.workflowRunId) {
      continue;
    }
    const runEvents = eventsByRunId.get(event.workflowRunId) ?? [];
    runEvents.push(event);
    eventsByRunId.set(event.workflowRunId, runEvents);
  }

  const timelinesByRunId = new Map(
    runs.map((run) => [
      run.id,
      buildTimeline(
        run,
        stepsByRunId.get(run.id) ?? [],
        eventsByRunId.get(run.id) ?? [],
      ),
    ]),
  );

  const result = new Map<string, WebAgentResponseTimeline>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const run = findRunForAssistantMessage(message, messages[index - 1], runs);
    const timeline = run ? timelinesByRunId.get(run.id) : undefined;
    if (timeline) {
      result.set(message.id, timeline);
    }
  }

  return result;
}

export function attachTimelineToMessage(
  message: WebAgentUIMessage,
  timeline: WebAgentResponseTimeline | undefined,
): WebAgentUIMessage {
  if (!timeline) {
    return message;
  }

  const responseInferenceDurationMs = timeline.segments
    .filter((segment) => segment.category === "inference")
    .reduce((total, segment) => total + segment.durationMs, 0);

  return {
    ...message,
    metadata: {
      ...message.metadata,
      ...(responseInferenceDurationMs > 0
        ? { responseInferenceDurationMs }
        : {}),
      responseTimeline: timeline,
    },
  };
}
