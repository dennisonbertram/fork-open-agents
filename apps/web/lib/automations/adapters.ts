import {
  adaptBackgroundAgentDefinition,
  adaptFrozenLoopAgentStepDefinition,
} from "@/lib/agent-definition/adapters";
import { loopDefinitionSchema } from "@/lib/agent-loops/types";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { formatTriggerLabel } from "@/lib/background-agents/trigger-label";
import type {
  AgentLoop,
  AgentLoopRun,
  BackgroundAgentRun,
  BackgroundAgentTrigger,
} from "@/lib/db/schema";
import {
  adaptAgentLoopRun,
  adaptBackgroundAgentRun,
  type RunAdapterOptions,
} from "@/lib/runs/adapters";
import { makeAutomationId } from "./identity";
import type { AutomationListItem } from "./types";

export type LoopAutomationTrigger = Pick<
  BackgroundAgentTrigger,
  | "id"
  | "loopId"
  | "userId"
  | "kind"
  | "status"
  | "conditions"
  | "schedule"
  | "nextRunAt"
  | "createdAt"
>;

export type BackgroundAutomationSourceRecord = {
  agent: BackgroundAgentWithTriggers;
  latestRun: BackgroundAgentRun | null;
};

export type LoopAutomationSourceRecord = {
  loop: AgentLoop;
  triggers: LoopAutomationTrigger[];
  latestRun: (AgentLoopRun & { failedStepCount: number }) | null;
};

export type AutomationAdaptation = {
  item: AutomationListItem;
  invalid: boolean;
};

function encodedPath(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function earliestNextRun(
  triggers: Array<Pick<BackgroundAgentTrigger, "status" | "nextRunAt">>,
): string | null {
  let earliest: Date | null = null;
  for (const trigger of triggers) {
    if (trigger.status !== "enabled" || !trigger.nextRunAt) continue;
    if (!earliest || trigger.nextRunAt < earliest) earliest = trigger.nextRunAt;
  }
  return earliest?.toISOString() ?? null;
}

function triggerSummary(
  triggers: Array<
    Pick<BackgroundAgentTrigger, "kind" | "status" | "conditions" | "nextRunAt">
  >,
): AutomationListItem["triggers"] {
  return {
    total: triggers.length,
    enabled: triggers.filter((trigger) => trigger.status === "enabled").length,
    kinds: uniqueSorted(triggers.map((trigger) => trigger.kind)),
    labels: uniqueSorted(
      triggers.map((trigger) =>
        formatTriggerLabel(trigger.kind, trigger.conditions),
      ),
    ).slice(0, 3),
    nextRunAt: earliestNextRun(triggers),
  };
}

function countEnabledPublishingActions(actions: Record<string, unknown>) {
  return Object.values(actions).filter((value) => value === true).length;
}

export function adaptBackgroundAutomation(
  record: BackgroundAutomationSourceRecord,
  options: RunAdapterOptions = {},
): AutomationAdaptation {
  const { agent, latestRun } = record;
  let invalid = false;
  let configuredStepCount: number | null = null;
  let publishingActionCount: number | null = null;

  try {
    const adaptation = adaptBackgroundAgentDefinition(agent);
    configuredStepCount = adaptation.definition.verification.checkCommand
      ? 1
      : 0;
    publishingActionCount = countEnabledPublishingActions(
      adaptation.separation.publishingPolicy.githubActions,
    );
  } catch {
    invalid = true;
  }

  const repoPath = encodedPath(agent.repoOwner, agent.repoName);
  const agentPath = encodedPath(agent.id);
  const normalizedLatestRun = latestRun
    ? adaptBackgroundAgentRun(
        {
          id: latestRun.id,
          title: agent.name,
          nativeStatus: latestRun.status,
          nativeSource: latestRun.source,
          triggerKind: latestRun.triggerKind,
          repoOwner: latestRun.repoOwner,
          repoName: latestRun.repoName,
          branch: latestRun.branch,
          prNumber: latestRun.prNumber,
          issueNumber: latestRun.issueNumber,
          // The definition list links to the owned Run detail route. It does
          // not need arbitrary source output URLs, which may contain signed
          // query parameters or other credentials.
          outputUrl: null,
          errorKind: latestRun.errorKind,
          createdAt: latestRun.createdAt,
          updatedAt: latestRun.updatedAt,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
        },
        options,
      )
    : null;

  return {
    invalid,
    item: {
      id: makeAutomationId("background_agent", agent.id),
      source: "background_agent",
      sourceId: agent.id,
      kind: "single_step",
      name: agent.name,
      description: agent.description,
      repository: { owner: agent.repoOwner, name: agent.repoName },
      nativeStatus: agent.status,
      operability: agent.status === "enabled" ? "active" : "inactive",
      configurationHealth: invalid ? "invalid" : "valid",
      configurationErrorKind: invalid ? "automation_definition_invalid" : null,
      observedRevision: {
        contractVersion: 1,
        sourceUpdatedAt: agent.updatedAt.toISOString(),
      },
      stepCount: 1,
      triggers: triggerSummary(agent.triggers),
      verification: {
        configuredStepCount,
        totalVerifiableSteps: invalid ? null : 1,
      },
      output: {
        declaredSchemaCount: invalid ? null : 0,
        publishingActionCount,
      },
      latestRun: normalizedLatestRun,
      detailUrl: `/repos/${repoPath}/agents/${agentPath}`,
      editUrl: `/repos/${repoPath}/agents/${agentPath}/edit`,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    },
  };
}

export function adaptLoopAutomation(
  record: LoopAutomationSourceRecord,
  options: RunAdapterOptions = {},
): AutomationAdaptation {
  const { loop, latestRun } = record;
  const parsed = loopDefinitionSchema.safeParse(loop.definition);
  let invalid = !parsed.success;
  let stepCount: number | null = null;
  let configuredStepCount: number | null = null;
  let totalVerifiableSteps: number | null = null;
  let declaredSchemaCount: number | null = null;

  if (parsed.success) {
    const executableNodes = parsed.data.nodes.filter(
      (node) => node.kind !== "start" && node.kind !== "end",
    );
    const agentSteps = parsed.data.nodes.filter(
      (node) => node.kind === "agent_step",
    );
    const githubChecks = parsed.data.nodes.filter(
      (node) => node.kind === "github_check",
    );
    try {
      const definitions = agentSteps.map((node) =>
        adaptFrozenLoopAgentStepDefinition({
          loopId: loop.id,
          node,
          loopPermissions: loop.permissions,
        }),
      );
      stepCount = executableNodes.length;
      configuredStepCount =
        githubChecks.length +
        definitions.filter(
          (definition) => definition.definition.verification.checkCommand,
        ).length;
      totalVerifiableSteps = githubChecks.length + definitions.length;
      declaredSchemaCount = definitions.filter(
        (definition) => definition.definition.output.schema !== null,
      ).length;
    } catch {
      invalid = true;
    }
  }

  if (invalid) {
    stepCount = null;
    configuredStepCount = null;
    totalVerifiableSteps = null;
    declaredSchemaCount = null;
  }

  const loopPath = encodedPath(loop.id);
  const normalizedLatestRun = latestRun
    ? adaptAgentLoopRun(
        {
          id: latestRun.id,
          loopId: loop.id,
          title: loop.name,
          nativeStatus: latestRun.status,
          nativeSource: latestRun.source,
          repoOwner: loop.repoOwner,
          repoName: loop.repoName,
          currentNodeId: latestRun.currentNodeId,
          stepCount: latestRun.stepCount,
          failedStepCount: latestRun.failedStepCount,
          errorKind: latestRun.errorKind,
          createdAt: latestRun.createdAt,
          updatedAt: latestRun.updatedAt,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
        },
        options,
      )
    : null;

  return {
    invalid,
    item: {
      id: makeAutomationId("agent_loop", loop.id),
      source: "agent_loop",
      sourceId: loop.id,
      kind: "multi_step",
      name: loop.name,
      description: loop.description,
      repository: { owner: loop.repoOwner, name: loop.repoName },
      nativeStatus: loop.status,
      operability: loop.status === "active" ? "active" : "inactive",
      configurationHealth: invalid ? "invalid" : "valid",
      configurationErrorKind: invalid ? "automation_definition_invalid" : null,
      observedRevision: {
        contractVersion: 1,
        sourceUpdatedAt: loop.updatedAt.toISOString(),
      },
      stepCount,
      triggers: triggerSummary(record.triggers),
      verification: { configuredStepCount, totalVerifiableSteps },
      output: {
        declaredSchemaCount,
        publishingActionCount: invalid ? null : 0,
      },
      latestRun: normalizedLatestRun,
      detailUrl: `/loops/${loopPath}`,
      editUrl: `/loops/${loopPath}/builder`,
      createdAt: loop.createdAt.toISOString(),
      updatedAt: loop.updatedAt.toISOString(),
    },
  };
}
