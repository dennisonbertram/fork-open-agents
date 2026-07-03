import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";

/**
 * Shared AgentCard test fixture — moved out of agent-card.test.tsx so both the
 * string-matching suite and the DOM-interaction suite (agent-card.dom.test.tsx)
 * can build a fully-typed BackgroundAgentWithTriggers without duplicating this
 * factory. Default trigger is github.deployment_status (not schedule.cron), so
 * AgentScheduleCard stays unrendered in tests that don't care about it.
 */
export function makeAgent(
  overrides: Partial<BackgroundAgentWithTriggers> = {},
): BackgroundAgentWithTriggers {
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Deploy Smoke",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Run smoke checks after deployments.",
    permissions: {},
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: {
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    },
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    modelId: null,
    runBudgetPerTarget: 10,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [
      {
        id: "trigger-1",
        agentId: "agent-1",
        loopId: null,
        userId: "user-1",
        name: "On deployment",
        kind: "github.deployment_status",
        status: "enabled",
        conditions: {},
        schedule: null,
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    ...overrides,
  };
}
