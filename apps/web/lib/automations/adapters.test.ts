import { describe, expect, test } from "bun:test";
import {
  adaptBackgroundAutomation,
  adaptLoopAutomation,
  type BackgroundAutomationSourceRecord,
  type LoopAutomationSourceRecord,
} from "./adapters";

const now = new Date("2026-07-11T12:00:00.000Z");

function backgroundRecord(): BackgroundAutomationSourceRecord {
  return {
    agent: {
      id: "shared-id",
      userId: "user-1",
      name: "PR reviewer",
      description: "Reviews pull requests",
      status: "enabled",
      repoOwner: "acme owner",
      repoName: "widgets/review",
      instructions: "prompt-secret-marker",
      checkCommand: "command-secret-marker",
      permissions: { github: { contents: "read" } },
      composioToolkitSlugs: ["tool-secret-marker"],
      builtinToolNames: ["bash"],
      githubActions: { comment_on_pr_or_issue: true },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      runBudgetPerTarget: 10,
      modelId: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
      triggers: [
        {
          id: "trigger-1",
          agentId: "shared-id",
          loopId: null,
          userId: "user-1",
          name: "Merged PR",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {
            actions: ["closed"],
            mergedOnly: true,
            actors: ["actor-secret-marker"],
          },
          schedule: null,
          webhookPublicId: "public-hook-secret-marker",
          webhookSecretHash: "webhook-secret-marker",
          lastRunAt: null,
          nextRunAt: new Date("2026-07-12T00:00:00.000Z"),
          lastSkipReason: null,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    },
    latestRun: {
      id: "background-run-1",
      agentId: "shared-id",
      triggerId: "trigger-1",
      userId: "user-1",
      status: "succeeded",
      source: "github",
      triggerKind: "github.pull_request",
      externalId: "external-1",
      idempotencyKey: "idempotency-secret-marker",
      repoOwner: "acme owner",
      repoName: "widgets/review",
      ref: "refs/heads/main",
      sha: null,
      branch: "main",
      prNumber: 42,
      issueNumber: null,
      deploymentUrl: null,
      sandboxName: "sandbox-secret-marker",
      outputUrl:
        "https://github.com/acme/widgets/pull/42?token=output-token-marker",
      errorKind: null,
      errorMessage: null,
      payloadSummary: {},
      resultSummary: null,
      requestId: "request-evidence-1",
      workflowRunId: "workflow-evidence-1",
      startedAt: new Date("2026-07-10T01:00:00.000Z"),
      finishedAt: new Date("2026-07-10T01:05:00.000Z"),
      createdAt: new Date("2026-07-10T01:00:00.000Z"),
      updatedAt: new Date("2026-07-10T01:05:00.000Z"),
    },
  } as unknown as BackgroundAutomationSourceRecord;
}

function loopRecord(): LoopAutomationSourceRecord {
  return {
    loop: {
      id: "shared-id",
      userId: "user-1",
      name: "Review and fix",
      description: null,
      repoOwner: "acme",
      repoName: "widgets",
      status: "paused",
      definition: {
        nodes: [
          {
            id: "start",
            kind: "start",
            label: "Start",
            position: { x: 0, y: 0 },
          },
          {
            id: "review",
            kind: "agent_step",
            label: "Review",
            position: { x: 1, y: 0 },
            checkCommand: "bun test",
            outputSchema: { result: "string" },
          },
          {
            id: "checks",
            kind: "github_check",
            label: "CI",
            position: { x: 2, y: 0 },
          },
          { id: "end", kind: "end", label: "End", position: { x: 3, y: 0 } },
        ],
        edges: [],
      },
      guardrails: null,
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-09T00:00:00.000Z"),
    },
    triggers: [
      {
        id: "loop-trigger-1",
        loopId: "shared-id",
        userId: "user-1",
        kind: "schedule.cron",
        status: "enabled",
        conditions: {},
        schedule: "0 * * * *",
        nextRunAt: new Date("2026-07-12T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    latestRun: {
      id: "loop-run-1",
      loopId: "shared-id",
      userId: "user-1",
      status: "completed",
      definitionSnapshot: {},
      currentNodeId: null,
      currentStepRunId: null,
      iterationCount: 0,
      stepCount: 2,
      context: {},
      source: "schedule",
      triggerId: "loop-trigger-1",
      idempotencyKey: "loop-idempotency-secret",
      errorKind: null,
      errorMessage: null,
      workflowRunId: "loop-workflow-evidence-1",
      requestId: "loop-request-evidence-1",
      startedAt: new Date("2026-07-09T01:00:00.000Z"),
      finishedAt: new Date("2026-07-09T01:05:00.000Z"),
      createdAt: new Date("2026-07-09T01:00:00.000Z"),
      updatedAt: new Date("2026-07-09T01:05:00.000Z"),
      failedStepCount: 1,
    },
  } as unknown as LoopAutomationSourceRecord;
}

describe("Automation adapters", () => {
  test("projects a background agent as a redacted single-step Automation with raw-run association intact", () => {
    const result = adaptBackgroundAutomation(backgroundRecord(), { now });

    expect(result.item).toMatchObject({
      source: "background_agent",
      sourceId: "shared-id",
      kind: "single_step",
      nativeStatus: "enabled",
      operability: "active",
      stepCount: 1,
      detailUrl: "/automations/background-agent/shared-id",
      editUrl: "/automations/background-agent/shared-id/edit",
      latestRun: {
        sourceId: "background-run-1",
        detailUrl: "/runs/background-agent/background-run-1",
        automation: { source: "background_agent", sourceId: "shared-id" },
        trigger: {
          id: "trigger-1",
          source: "github",
          kind: "github.pull_request",
        },
        evidence: {
          requestId: "request-evidence-1",
          workflowRunId: "workflow-evidence-1",
          sandboxName: null,
          outputUrl: null,
        },
      },
    });
    expect(result.item.triggers).toMatchObject({ total: 1, enabled: 1 });
    const serialized = JSON.stringify(result.item);
    for (const marker of [
      "prompt-secret-marker",
      "command-secret-marker",
      "tool-secret-marker",
      "actor-secret-marker",
      "public-hook-secret-marker",
      "webhook-secret-marker",
      "idempotency-secret-marker",
      "sandbox-secret-marker",
      "output-token-marker",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  test("projects a loop as a multi-step Automation with truthful verification, output, and Run links", () => {
    const result = adaptLoopAutomation(loopRecord(), { now });

    expect(result.item).toMatchObject({
      source: "agent_loop",
      sourceId: "shared-id",
      kind: "multi_step",
      nativeStatus: "paused",
      operability: "inactive",
      stepCount: 2,
      verification: { configuredStepCount: 2, totalVerifiableSteps: 2 },
      output: { declaredSchemaCount: 1, publishingActionCount: 0 },
      detailUrl: "/automations/agent-loop/shared-id",
      editUrl: "/automations/agent-loop/shared-id/edit",
      latestRun: {
        sourceId: "loop-run-1",
        detailUrl: "/runs/loop/loop-run-1",
        health: "warning",
        automation: { source: "agent_loop", sourceId: "shared-id" },
        trigger: {
          id: "loop-trigger-1",
          source: "schedule",
          kind: "schedule.cron",
        },
        progress: {
          currentStepId: null,
          completedSteps: 2,
          totalSteps: 2,
        },
        evidence: {
          requestId: "loop-request-evidence-1",
          workflowRunId: "loop-workflow-evidence-1",
          sandboxName: null,
          outputUrl: null,
        },
      },
    });
  });

  test("keeps invalid legacy loop records visible with bounded unknown summaries", () => {
    const record = loopRecord();
    record.loop.definition = { prompt: "invalid-secret-marker" };

    const result = adaptLoopAutomation(record, { now });

    expect(result.invalid).toBe(true);
    expect(result.item).toMatchObject({
      configurationHealth: "invalid",
      configurationErrorKind: "automation_definition_invalid",
      stepCount: null,
      verification: { configuredStepCount: null },
    });
    expect(JSON.stringify(result.item)).not.toContain("invalid-secret-marker");
  });
});
