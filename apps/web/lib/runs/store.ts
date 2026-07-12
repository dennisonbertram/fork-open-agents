import "server-only";

import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentLoopRuns,
  agentLoops,
  agentLoopStepRuns,
  backgroundAgentRuns,
  backgroundAgents,
  backgroundAgentTriggers,
} from "@/lib/db/schema";
import { redactText } from "@/lib/account-coordinator/redaction";
import { adaptAgentLoopRun, adaptBackgroundAgentRun } from "./adapters";
import {
  listAutomationRuns,
  type RunsListResponse,
  type RunsSourceLoader,
  type RunsSourceLoaders,
} from "./list";
import type { RunsCursor, RunsFilters } from "./query";
import { DEFAULT_RUN_STALE_AFTER_MS } from "./status";
import type { NormalizedAutomationRun } from "./types";

function compactConditions(values: Array<SQL | undefined>): SQL[] {
  return values.filter((value): value is SQL => value !== undefined);
}

function cursorCondition(params: {
  source: "background_agent" | "agent_loop";
  cursor: RunsCursor | undefined;
  createdAt:
    | typeof backgroundAgentRuns.createdAt
    | typeof agentLoopRuns.createdAt;
  id: typeof backgroundAgentRuns.id | typeof agentLoopRuns.id;
}): SQL | undefined {
  if (!params.cursor) return undefined;
  const cursorDate = new Date(params.cursor.createdAt);
  return or(
    lt(params.createdAt, cursorDate),
    and(
      eq(params.createdAt, cursorDate),
      sql`concat(${`${params.source}:`}, ${params.id}) < ${params.cursor.id}`,
    ),
  );
}

function repositoryConditions(
  filters: RunsFilters,
  owner: typeof backgroundAgentRuns.repoOwner | typeof agentLoops.repoOwner,
  name: typeof backgroundAgentRuns.repoName | typeof agentLoops.repoName,
): Array<SQL | undefined> {
  return [
    filters.repoOwner
      ? sql`lower(${owner}) = ${filters.repoOwner.toLowerCase()}`
      : undefined,
    filters.repoName
      ? sql`lower(${name}) = ${filters.repoName.toLowerCase()}`
      : undefined,
  ];
}

function backgroundViewCondition(
  filters: RunsFilters,
  now: Date,
): SQL | undefined {
  if (filters.view === "active") {
    return inArray(backgroundAgentRuns.status, ["queued", "running"]);
  }
  if (filters.view === "completed") {
    return inArray(backgroundAgentRuns.status, [
      "succeeded",
      "failed",
      "skipped",
      "cancelled",
    ]);
  }
  if (filters.view === "attention") {
    const staleBefore = new Date(now.getTime() - DEFAULT_RUN_STALE_AFTER_MS);
    return or(
      inArray(backgroundAgentRuns.status, ["failed", "cancelled"]),
      and(
        inArray(backgroundAgentRuns.status, ["queued", "running"]),
        lt(backgroundAgentRuns.updatedAt, staleBefore),
      ),
    );
  }
  return undefined;
}

function loopViewCondition(filters: RunsFilters, now: Date): SQL | undefined {
  if (filters.view === "active") {
    return inArray(agentLoopRuns.status, [
      "queued",
      "running",
      "paused",
      "stalled",
    ]);
  }
  if (filters.view === "completed") {
    return inArray(agentLoopRuns.status, ["completed", "failed", "cancelled"]);
  }
  if (filters.view === "attention") {
    const staleBefore = new Date(now.getTime() - DEFAULT_RUN_STALE_AFTER_MS);
    return or(
      inArray(agentLoopRuns.status, [
        "paused",
        "stalled",
        "failed",
        "cancelled",
      ]),
      and(
        inArray(agentLoopRuns.status, ["queued", "running"]),
        lt(agentLoopRuns.updatedAt, staleBefore),
      ),
      and(
        eq(agentLoopRuns.status, "completed"),
        sql`exists (select 1 from ${agentLoopStepRuns} where ${agentLoopStepRuns.loopRunId} = ${agentLoopRuns.id} and ${agentLoopStepRuns.status} = 'failed')`,
      ),
    );
  }
  return undefined;
}

function matchesView(
  run: NormalizedAutomationRun,
  filters: RunsFilters,
): boolean {
  if (filters.view === "active") {
    return (
      run.state === "queued" ||
      run.state === "running" ||
      run.state === "waiting"
    );
  }
  if (filters.view === "completed") return run.state === "finished";
  if (filters.view === "attention") return run.health !== "ok";
  return true;
}

function createBackgroundRunLoader(userId: string): RunsSourceLoader {
  return async (query) => {
    if (
      query.filters.automationSource &&
      query.filters.automationSource !== "background_agent"
    ) {
      return [];
    }
    const rows = await db
      .select({
        id: backgroundAgentRuns.id,
        agentId: backgroundAgentRuns.agentId,
        triggerId: backgroundAgentRuns.triggerId,
        agentName: backgroundAgents.name,
        snapshotDefinitionName: sql<
          string | null
        >`${backgroundAgentRuns.executionSnapshot} -> 'source' ->> 'name'`,
        status: backgroundAgentRuns.status,
        source: backgroundAgentRuns.source,
        triggerKind: backgroundAgentRuns.triggerKind,
        repoOwner: backgroundAgentRuns.repoOwner,
        repoName: backgroundAgentRuns.repoName,
        branch: backgroundAgentRuns.branch,
        prNumber: backgroundAgentRuns.prNumber,
        issueNumber: backgroundAgentRuns.issueNumber,
        outputUrl: backgroundAgentRuns.outputUrl,
        errorKind: backgroundAgentRuns.errorKind,
        sandboxName: backgroundAgentRuns.sandboxName,
        requestId: backgroundAgentRuns.requestId,
        workflowRunId: backgroundAgentRuns.workflowRunId,
        createdAt: backgroundAgentRuns.createdAt,
        updatedAt: backgroundAgentRuns.updatedAt,
        startedAt: backgroundAgentRuns.startedAt,
        finishedAt: backgroundAgentRuns.finishedAt,
      })
      .from(backgroundAgentRuns)
      .leftJoin(
        backgroundAgents,
        and(
          eq(backgroundAgents.id, backgroundAgentRuns.agentId),
          eq(backgroundAgents.userId, userId),
        ),
      )
      .leftJoin(
        backgroundAgentTriggers,
        and(
          eq(backgroundAgentTriggers.id, backgroundAgentRuns.triggerId),
          eq(backgroundAgentTriggers.userId, userId),
        ),
      )
      .where(
        and(
          ...compactConditions([
            eq(backgroundAgentRuns.userId, userId),
            ...repositoryConditions(
              query.filters,
              backgroundAgentRuns.repoOwner,
              backgroundAgentRuns.repoName,
            ),
            query.filters.automationId
              ? eq(backgroundAgentRuns.agentId, query.filters.automationId)
              : undefined,
            query.filters.triggerSource
              ? sql`${backgroundAgentRuns.source} = ${query.filters.triggerSource}`
              : undefined,
            query.filters.triggerKind
              ? sql`${backgroundAgentRuns.triggerKind} = ${query.filters.triggerKind}`
              : undefined,
            query.filters.triggerId
              ? eq(backgroundAgentRuns.triggerId, query.filters.triggerId)
              : undefined,
            backgroundViewCondition(query.filters, query.now),
            cursorCondition({
              source: "background_agent",
              cursor: query.cursor,
              createdAt: backgroundAgentRuns.createdAt,
              id: backgroundAgentRuns.id,
            }),
          ]),
        ),
      )
      .orderBy(
        desc(backgroundAgentRuns.createdAt),
        desc(backgroundAgentRuns.id),
      )
      .limit(query.limit);

    return rows
      .map((row) =>
        adaptBackgroundAgentRun(
          {
            ...row,
            title:
              redactText(row.agentName, 120) ??
              (redactText(row.snapshotDefinitionName, 120)
                ? `${redactText(row.snapshotDefinitionName, 120)} (deleted)`
                : "Deleted automation"),
            nativeStatus: row.status,
            nativeSource: row.source,
          },
          { now: query.now },
        ),
      )
      .filter((run) => matchesView(run, query.filters));
  };
}

function createLoopRunLoader(userId: string): RunsSourceLoader {
  return async (query) => {
    if (
      query.filters.automationSource &&
      query.filters.automationSource !== "agent_loop"
    ) {
      return [];
    }
    const rows = await db
      .select({
        id: agentLoopRuns.id,
        loopId: agentLoopRuns.loopId,
        triggerId: agentLoopRuns.triggerId,
        triggerKind: backgroundAgentTriggers.kind,
        loopName: agentLoops.name,
        repoOwner: agentLoops.repoOwner,
        repoName: agentLoops.repoName,
        status: agentLoopRuns.status,
        source: agentLoopRuns.source,
        currentNodeId: agentLoopRuns.currentNodeId,
        stepCount: agentLoopRuns.stepCount,
        failedStepCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${agentLoopStepRuns} WHERE ${agentLoopStepRuns.loopRunId} = ${agentLoopRuns.id} AND ${agentLoopStepRuns.status} = 'failed'), 0)`,
        errorKind: agentLoopRuns.errorKind,
        requestId: agentLoopRuns.requestId,
        workflowRunId: agentLoopRuns.workflowRunId,
        createdAt: agentLoopRuns.createdAt,
        updatedAt: agentLoopRuns.updatedAt,
        startedAt: agentLoopRuns.startedAt,
        finishedAt: agentLoopRuns.finishedAt,
      })
      .from(agentLoopRuns)
      .leftJoin(
        agentLoops,
        and(
          eq(agentLoops.id, agentLoopRuns.loopId),
          eq(agentLoops.userId, userId),
        ),
      )
      .leftJoin(
        backgroundAgentTriggers,
        and(
          eq(backgroundAgentTriggers.id, agentLoopRuns.triggerId),
          eq(backgroundAgentTriggers.userId, userId),
        ),
      )
      .where(
        and(
          ...compactConditions([
            eq(agentLoopRuns.userId, userId),
            ...repositoryConditions(
              query.filters,
              agentLoops.repoOwner,
              agentLoops.repoName,
            ),
            query.filters.automationId
              ? eq(agentLoopRuns.loopId, query.filters.automationId)
              : undefined,
            query.filters.triggerSource
              ? sql`${agentLoopRuns.source} = ${query.filters.triggerSource}`
              : undefined,
            query.filters.triggerKind
              ? sql`${backgroundAgentTriggers.kind} = ${query.filters.triggerKind}`
              : undefined,
            query.filters.triggerId
              ? eq(agentLoopRuns.triggerId, query.filters.triggerId)
              : undefined,
            loopViewCondition(query.filters, query.now),
            cursorCondition({
              source: "agent_loop",
              cursor: query.cursor,
              createdAt: agentLoopRuns.createdAt,
              id: agentLoopRuns.id,
            }),
          ]),
        ),
      )
      .orderBy(desc(agentLoopRuns.createdAt), desc(agentLoopRuns.id))
      .limit(query.limit);

    return rows
      .map((row) =>
        adaptAgentLoopRun(
          {
            id: row.id,
            loopId: row.loopId,
            triggerId: row.triggerId,
            triggerKind: row.triggerKind,
            title: redactText(row.loopName, 120) ?? "Deleted automation",
            nativeStatus: row.status,
            nativeSource: row.source,
            repoOwner: row.repoOwner,
            repoName: row.repoName,
            currentNodeId: row.currentNodeId,
            stepCount: row.stepCount,
            totalStepCount: null,
            failedStepCount: Number(row.failedStepCount),
            errorKind: row.errorKind,
            requestId: row.requestId,
            workflowRunId: row.workflowRunId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
          },
          { now: query.now },
        ),
      )
      .filter((run) => matchesView(run, query.filters));
  };
}

export function createDbRunSourceLoaders(params: {
  userId: string;
}): RunsSourceLoaders {
  return {
    background_agent: createBackgroundRunLoader(params.userId),
    agent_loop: createLoopRunLoader(params.userId),
  };
}

export function listDbBackedAutomationRuns(params: {
  userId: string;
  requestId: string;
  filters: RunsFilters;
  limit: number;
  cursor?: RunsCursor;
  now?: Date;
}): Promise<RunsListResponse> {
  return listAutomationRuns({
    requestId: params.requestId,
    filters: params.filters,
    limit: params.limit,
    cursor: params.cursor,
    now: params.now,
    loaders: createDbRunSourceLoaders({ userId: params.userId }),
  });
}
