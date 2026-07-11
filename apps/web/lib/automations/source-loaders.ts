import "server-only";

import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { listAgentLoops } from "@/lib/agent-loops/store";
import { listBackgroundAgents } from "@/lib/background-agents/store";
import { db } from "@/lib/db/client";
import {
  agentLoopRuns,
  agentLoopStepRuns,
  backgroundAgentRuns,
  backgroundAgentTriggers,
  type AgentLoop,
  type AgentLoopRun,
  type BackgroundAgentRun,
} from "@/lib/db/schema";
import {
  adaptBackgroundAutomation,
  adaptLoopAutomation,
  type LoopAutomationTrigger,
} from "./adapters";
import type { AutomationListItem } from "./types";

export type LoadedAutomationSource = {
  items: AutomationListItem[];
  invalidItemCount: number;
};

type DefinitionScope = { userId: string };
type BackgroundDefinitionScope = DefinitionScope & { agentIds: string[] };
type LoopDefinitionScope = DefinitionScope & { loopIds: string[] };
type LoopRunScope = DefinitionScope & { runIds: string[] };

export async function listLatestBackgroundAutomationRuns(
  params: BackgroundDefinitionScope,
): Promise<BackgroundAgentRun[]> {
  if (params.agentIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([backgroundAgentRuns.agentId], {
      run: backgroundAgentRuns,
    })
    .from(backgroundAgentRuns)
    .where(
      and(
        eq(backgroundAgentRuns.userId, params.userId),
        isNotNull(backgroundAgentRuns.agentId),
        inArray(backgroundAgentRuns.agentId, params.agentIds),
      ),
    )
    .orderBy(
      backgroundAgentRuns.agentId,
      desc(backgroundAgentRuns.createdAt),
      desc(backgroundAgentRuns.id),
    );
  return rows.map((row) => row.run);
}

export async function listLoopAutomationTriggers(
  params: LoopDefinitionScope,
): Promise<LoopAutomationTrigger[]> {
  if (params.loopIds.length === 0) return [];
  return db.query.backgroundAgentTriggers.findMany({
    where: and(
      eq(backgroundAgentTriggers.userId, params.userId),
      isNotNull(backgroundAgentTriggers.loopId),
      inArray(backgroundAgentTriggers.loopId, params.loopIds),
    ),
    orderBy: [desc(backgroundAgentTriggers.createdAt)],
    columns: {
      id: true,
      loopId: true,
      userId: true,
      kind: true,
      status: true,
      conditions: true,
      schedule: true,
      nextRunAt: true,
      createdAt: true,
    },
  });
}

export async function listLatestLoopAutomationRuns(
  params: LoopDefinitionScope,
): Promise<AgentLoopRun[]> {
  if (params.loopIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([agentLoopRuns.loopId], { run: agentLoopRuns })
    .from(agentLoopRuns)
    .where(
      and(
        eq(agentLoopRuns.userId, params.userId),
        inArray(agentLoopRuns.loopId, params.loopIds),
      ),
    )
    .orderBy(
      agentLoopRuns.loopId,
      desc(agentLoopRuns.createdAt),
      desc(agentLoopRuns.id),
    );
  return rows.map((row) => row.run);
}

export async function listLoopFailedStepCounts(
  params: LoopRunScope,
): Promise<Map<string, number>> {
  if (params.runIds.length === 0) return new Map();
  const rows = await db
    .select({
      runId: agentLoopStepRuns.loopRunId,
      failedStepCount: count(agentLoopStepRuns.id),
    })
    .from(agentLoopStepRuns)
    .innerJoin(agentLoopRuns, eq(agentLoopRuns.id, agentLoopStepRuns.loopRunId))
    .where(
      and(
        eq(agentLoopRuns.userId, params.userId),
        inArray(agentLoopRuns.id, params.runIds),
        eq(agentLoopStepRuns.status, "failed"),
      ),
    )
    .groupBy(agentLoopStepRuns.loopRunId);
  return new Map(
    rows.map((row) => [row.runId, Number(row.failedStepCount)] as const),
  );
}

export type BackgroundSourceLoaderDependencies = {
  listAgents: typeof listBackgroundAgents;
  listLatestRuns: typeof listLatestBackgroundAutomationRuns;
};

export type LoopSourceLoaderDependencies = {
  listLoops: typeof listAgentLoops;
  listTriggers: typeof listLoopAutomationTriggers;
  listLatestRuns: typeof listLatestLoopAutomationRuns;
  listFailedStepCounts: typeof listLoopFailedStepCounts;
};

const defaultBackgroundDependencies: BackgroundSourceLoaderDependencies = {
  listAgents: listBackgroundAgents,
  listLatestRuns: listLatestBackgroundAutomationRuns,
};

const defaultLoopDependencies: LoopSourceLoaderDependencies = {
  listLoops: listAgentLoops,
  listTriggers: listLoopAutomationTriggers,
  listLatestRuns: listLatestLoopAutomationRuns,
  listFailedStepCounts: listLoopFailedStepCounts,
};

export async function loadBackgroundAutomationSource(
  userId: string,
  dependencies: BackgroundSourceLoaderDependencies = defaultBackgroundDependencies,
): Promise<LoadedAutomationSource> {
  const agents = await dependencies.listAgents(userId);
  const agentIds = agents.map((agent) => agent.id);
  const agentIdSet = new Set(agentIds);
  const runs = await dependencies.listLatestRuns({ userId, agentIds });
  const latestRunByAgentId = new Map<string, BackgroundAgentRun>();
  for (const run of runs) {
    if (
      run.userId !== userId ||
      !run.agentId ||
      !agentIdSet.has(run.agentId) ||
      latestRunByAgentId.has(run.agentId)
    ) {
      continue;
    }
    latestRunByAgentId.set(run.agentId, run);
  }

  let invalidItemCount = 0;
  const items = agents.map((agent) => {
    const adaptation = adaptBackgroundAutomation({
      agent,
      latestRun: latestRunByAgentId.get(agent.id) ?? null,
    });
    if (adaptation.invalid) invalidItemCount += 1;
    return adaptation.item;
  });
  return { items, invalidItemCount };
}

export async function loadLoopAutomationSource(
  userId: string,
  dependencies: LoopSourceLoaderDependencies = defaultLoopDependencies,
): Promise<LoadedAutomationSource> {
  const loops = await dependencies.listLoops(userId);
  const loopIds = loops.map((loop) => loop.id);
  const loopIdSet = new Set(loopIds);
  const scope = { userId, loopIds };
  const [triggers, latestRuns] = await Promise.all([
    dependencies.listTriggers(scope),
    dependencies.listLatestRuns(scope),
  ]);

  const triggersByLoopId = new Map<string, LoopAutomationTrigger[]>();
  for (const trigger of triggers) {
    if (
      trigger.userId !== userId ||
      !trigger.loopId ||
      !loopIdSet.has(trigger.loopId)
    ) {
      continue;
    }
    const current = triggersByLoopId.get(trigger.loopId) ?? [];
    current.push(trigger);
    triggersByLoopId.set(trigger.loopId, current);
  }

  const latestRunByLoopId = new Map<string, AgentLoopRun>();
  for (const run of latestRuns) {
    if (
      run.userId !== userId ||
      !loopIdSet.has(run.loopId) ||
      latestRunByLoopId.has(run.loopId)
    ) {
      continue;
    }
    latestRunByLoopId.set(run.loopId, run);
  }
  const ownedRunIds = [...latestRunByLoopId.values()].map((run) => run.id);
  const failedStepCounts = await dependencies.listFailedStepCounts({
    userId,
    runIds: ownedRunIds,
  });

  let invalidItemCount = 0;
  const items = loops.map((loop: AgentLoop) => {
    const run = latestRunByLoopId.get(loop.id);
    const adaptation = adaptLoopAutomation({
      loop,
      triggers: triggersByLoopId.get(loop.id) ?? [],
      latestRun: run
        ? {
            ...run,
            failedStepCount: failedStepCounts.get(run.id) ?? 0,
          }
        : null,
    });
    if (adaptation.invalid) invalidItemCount += 1;
    return adaptation.item;
  });
  return { items, invalidItemCount };
}
