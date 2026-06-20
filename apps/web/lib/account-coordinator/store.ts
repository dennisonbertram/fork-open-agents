import "server-only";

import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentLoopRuns,
  agentLoops,
  backgroundAgentRuns,
  backgroundAgents,
  backgroundAgentTriggers,
  chats,
  sessions,
  workflowRuns,
} from "@/lib/db/schema";
import { redactText } from "./redaction";
import {
  buildAccountSnapshot,
  parseSnapshotWindow,
  type AccountSnapshotOptions,
  type AccountSnapshotSourceLoaders,
} from "./snapshot";
import type { AccountScheduledAgent } from "./types";

const DEFAULT_SOURCE_LIMIT = 50;
const MAX_SOURCE_LIMIT = 200;

function clampSourceLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_SOURCE_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_SOURCE_LIMIT);
}

export async function buildDbBackedAccountSnapshot(
  options: Omit<AccountSnapshotOptions, "loaders">,
) {
  const now = options.now ?? new Date();
  const window = parseSnapshotWindow(options.window, now);
  const sourceLimit = clampSourceLimit(options.sourceLimit);

  return buildAccountSnapshot({
    ...options,
    now,
    loaders: createAccountSnapshotLoaders({
      userId: options.userId,
      since: window.since,
      limit: sourceLimit,
    }),
  });
}

export function createAccountSnapshotLoaders(params: {
  userId: string;
  since: Date;
  limit?: number;
}): AccountSnapshotSourceLoaders {
  const limit = clampSourceLimit(params.limit);

  return {
    sessions: async () =>
      db
        .select({
          id: sessions.id,
          title: sessions.title,
          status: sessions.status,
          repoOwner: sessions.repoOwner,
          repoName: sessions.repoName,
          branch: sessions.branch,
          lifecycleState: sessions.lifecycleState,
          lifecycleError: sessions.lifecycleError,
          prNumber: sessions.prNumber,
          prStatus: sessions.prStatus,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, params.userId),
            or(
              gte(sessions.updatedAt, params.since),
              eq(sessions.status, "running"),
            ),
          ),
        )
        .orderBy(desc(sessions.updatedAt))
        .limit(limit),
    chatWorkflowRuns: async () =>
      db
        .select({
          id: workflowRuns.id,
          chatId: workflowRuns.chatId,
          chatTitle: chats.title,
          sessionId: workflowRuns.sessionId,
          sessionTitle: sessions.title,
          status: workflowRuns.status,
          runtimeMode: workflowRuns.runtimeMode,
          errorMessage: workflowRuns.errorMessage,
          startedAt: workflowRuns.startedAt,
          finishedAt: workflowRuns.finishedAt,
          createdAt: workflowRuns.createdAt,
        })
        .from(workflowRuns)
        .leftJoin(chats, eq(chats.id, workflowRuns.chatId))
        .leftJoin(sessions, eq(sessions.id, workflowRuns.sessionId))
        .where(
          and(
            eq(workflowRuns.userId, params.userId),
            gte(workflowRuns.createdAt, params.since),
          ),
        )
        .orderBy(desc(workflowRuns.createdAt))
        .limit(limit),
    backgroundAgentRuns: async () =>
      db
        .select({
          id: backgroundAgentRuns.id,
          agentName: backgroundAgents.name,
          status: backgroundAgentRuns.status,
          source: backgroundAgentRuns.source,
          triggerKind: backgroundAgentRuns.triggerKind,
          repoOwner: backgroundAgentRuns.repoOwner,
          repoName: backgroundAgentRuns.repoName,
          branch: backgroundAgentRuns.branch,
          prNumber: backgroundAgentRuns.prNumber,
          issueNumber: backgroundAgentRuns.issueNumber,
          errorKind: backgroundAgentRuns.errorKind,
          errorMessage: backgroundAgentRuns.errorMessage,
          outputUrl: backgroundAgentRuns.outputUrl,
          payloadSummary: backgroundAgentRuns.payloadSummary,
          createdAt: backgroundAgentRuns.createdAt,
          updatedAt: backgroundAgentRuns.updatedAt,
          startedAt: backgroundAgentRuns.startedAt,
          finishedAt: backgroundAgentRuns.finishedAt,
        })
        .from(backgroundAgentRuns)
        .leftJoin(
          backgroundAgents,
          eq(backgroundAgents.id, backgroundAgentRuns.agentId),
        )
        .where(
          and(
            eq(backgroundAgentRuns.userId, params.userId),
            or(
              gte(backgroundAgentRuns.createdAt, params.since),
              inArray(backgroundAgentRuns.status, ["queued", "running"]),
            ),
          ),
        )
        .orderBy(desc(backgroundAgentRuns.createdAt))
        .limit(limit),
    agentLoopRuns: async () =>
      db
        .select({
          id: agentLoopRuns.id,
          loopName: agentLoops.name,
          status: agentLoopRuns.status,
          source: agentLoopRuns.source,
          repoOwner: agentLoops.repoOwner,
          repoName: agentLoops.repoName,
          currentNodeId: agentLoopRuns.currentNodeId,
          stepCount: agentLoopRuns.stepCount,
          errorKind: agentLoopRuns.errorKind,
          errorMessage: agentLoopRuns.errorMessage,
          createdAt: agentLoopRuns.createdAt,
          updatedAt: agentLoopRuns.updatedAt,
          startedAt: agentLoopRuns.startedAt,
          finishedAt: agentLoopRuns.finishedAt,
        })
        .from(agentLoopRuns)
        .leftJoin(agentLoops, eq(agentLoops.id, agentLoopRuns.loopId))
        .where(
          and(
            eq(agentLoopRuns.userId, params.userId),
            or(
              gte(agentLoopRuns.createdAt, params.since),
              inArray(agentLoopRuns.status, [
                "queued",
                "running",
                "paused",
                "stalled",
              ]),
            ),
          ),
        )
        .orderBy(desc(agentLoopRuns.createdAt))
        .limit(limit),
    scheduledAgents: async () => {
      const rows = await db
        .select({
          id: backgroundAgentTriggers.id,
          name: backgroundAgentTriggers.name,
          triggerKind: backgroundAgentTriggers.kind,
          nextRunAt: backgroundAgentTriggers.nextRunAt,
          agentId: backgroundAgentTriggers.agentId,
          agentName: backgroundAgents.name,
          agentStatus: backgroundAgents.status,
          agentRepoOwner: backgroundAgents.repoOwner,
          agentRepoName: backgroundAgents.repoName,
          loopId: backgroundAgentTriggers.loopId,
          loopName: agentLoops.name,
          loopStatus: agentLoops.status,
          loopRepoOwner: agentLoops.repoOwner,
          loopRepoName: agentLoops.repoName,
        })
        .from(backgroundAgentTriggers)
        .leftJoin(
          backgroundAgents,
          eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
        )
        .leftJoin(agentLoops, eq(agentLoops.id, backgroundAgentTriggers.loopId))
        .where(
          and(
            eq(backgroundAgentTriggers.userId, params.userId),
            eq(backgroundAgentTriggers.kind, "schedule.cron"),
            eq(backgroundAgentTriggers.status, "enabled"),
            or(
              eq(backgroundAgents.status, "enabled"),
              eq(agentLoops.status, "active"),
            ),
          ),
        )
        .orderBy(desc(backgroundAgentTriggers.nextRunAt))
        .limit(limit);

      return rows.flatMap((row): AccountScheduledAgent[] => {
        if (row.agentId && row.agentRepoOwner && row.agentRepoName) {
          return [
            {
              id: row.agentId,
              name: redactText(row.agentName ?? row.name, 120) ?? "Agent",
              source: "background_agent",
              status: row.agentStatus ?? "disabled",
              repo: { owner: row.agentRepoOwner, name: row.agentRepoName },
              nextRunAt: row.nextRunAt?.toISOString(),
              triggerKind: row.triggerKind,
            },
          ];
        }

        if (row.loopId && row.loopRepoOwner && row.loopRepoName) {
          return [
            {
              id: row.loopId,
              name: redactText(row.loopName ?? row.name, 120) ?? "Loop",
              source: "agent_loop",
              status: row.loopStatus === "active" ? "active" : "paused",
              repo: { owner: row.loopRepoOwner, name: row.loopRepoName },
              nextRunAt: row.nextRunAt?.toISOString(),
              triggerKind: row.triggerKind,
            },
          ];
        }

        return [];
      });
    },
  };
}
