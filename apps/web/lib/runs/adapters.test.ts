import { describe, expect, test } from "bun:test";
import {
  adaptAgentLoopRun,
  adaptBackgroundAgentRun,
  adaptChatWorkflowRun,
} from "./adapters";

const createdAt = new Date("2026-07-11T10:00:00.000Z");
const updatedAt = new Date("2026-07-11T10:05:00.000Z");

describe("normalized run adapters", () => {
  test("source-qualifies colliding native ids", () => {
    const background = adaptBackgroundAgentRun({
      id: "same-id",
      title: "Review PR",
      nativeStatus: "succeeded",
      nativeSource: "github",
      triggerKind: "github.pull_request",
      repoOwner: "acme",
      repoName: "shop",
      branch: "feature",
      prNumber: 42,
      issueNumber: null,
      outputUrl: null,
      errorKind: null,
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: updatedAt,
    });
    const loop = adaptAgentLoopRun({
      id: "same-id",
      loopId: "loop-1",
      title: "Release loop",
      nativeStatus: "completed",
      nativeSource: "manual",
      repoOwner: "acme",
      repoName: "shop",
      currentNodeId: null,
      stepCount: 3,
      failedStepCount: 0,
      errorKind: null,
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: updatedAt,
    });

    expect(background.id).toBe("background_agent:same-id");
    expect(loop.id).toBe("agent_loop:same-id");
    expect(background.id).not.toBe(loop.id);
    expect(background.sourceId).toBe("same-id");
    expect(loop.sourceId).toBe("same-id");
  });

  test("retains native status, native trigger source, timestamps, and detail links", () => {
    const background = adaptBackgroundAgentRun({
      id: "run/1",
      title: "Review PR",
      nativeStatus: "skipped",
      nativeSource: "github",
      triggerKind: "github.pull_request",
      repoOwner: "acme",
      repoName: "shop",
      branch: "feature",
      prNumber: 42,
      issueNumber: null,
      outputUrl: "https://github.com/acme/shop/pull/42",
      errorKind: null,
      createdAt,
      updatedAt,
      startedAt: null,
      finishedAt: updatedAt,
    });

    expect(background).toMatchObject({
      nativeStatus: "skipped",
      nativeSource: "github",
      state: "finished",
      outcome: "skipped",
      detailUrl: "/runs/background-agent/run%2F1",
      repository: { owner: "acme", name: "shop", branch: "feature" },
      timestamps: {
        createdAt: "2026-07-11T10:00:00.000Z",
        updatedAt: "2026-07-11T10:05:00.000Z",
        startedAt: null,
        finishedAt: "2026-07-11T10:05:00.000Z",
      },
      progress: {
        currentStepId: null,
        completedSteps: 0,
        totalSteps: 1,
      },
    });
  });

  test("keeps chat workflow unknown status unknown and links to its chat", () => {
    const run = adaptChatWorkflowRun({
      id: "workflow-1",
      chatId: "chat/1",
      sessionId: "session/1",
      title: "Investigate",
      nativeStatus: "mystery",
      runtimeMode: "classic",
      createdAt,
      startedAt: createdAt,
      finishedAt: updatedAt,
    });

    expect(run).toMatchObject({
      id: "chat_workflow:workflow-1",
      nativeStatus: "mystery",
      nativeSource: null,
      state: "unknown",
      outcome: "unknown",
      health: "unknown",
      attentionReasons: ["unknown_status"],
      detailUrl: "/sessions/session%2F1/chats/chat%2F1",
    });
  });

  test("reports completed loop failed-step health without changing its outcome", () => {
    const run = adaptAgentLoopRun({
      id: "loop-run-1",
      loopId: "loop/1",
      title: "Release loop",
      nativeStatus: "completed",
      nativeSource: "schedule",
      repoOwner: "acme",
      repoName: "shop",
      currentNodeId: "finish",
      stepCount: 4,
      failedStepCount: 1,
      errorKind: null,
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: updatedAt,
    });

    expect(run).toMatchObject({
      state: "finished",
      outcome: "succeeded",
      health: "warning",
      attentionReasons: ["failed_steps"],
      detailUrl: "/runs/loop/loop-run-1",
      metadata: { stepCount: 4, failedStepCount: 1 },
    });
  });

  test("adds safe Automation, trigger, progress, and evidence context", () => {
    const background = adaptBackgroundAgentRun({
      id: "background-run-1",
      agentId: null,
      triggerId: "trigger-1",
      title: "Deleted automation",
      nativeStatus: "running",
      nativeSource: "github",
      triggerKind: "github.issue",
      repoOwner: "acme",
      repoName: "shop",
      branch: "fix/42",
      prNumber: null,
      issueNumber: 42,
      outputUrl: null,
      errorKind: null,
      sandboxName: "sandbox-1",
      requestId: "request-1",
      workflowRunId: "workflow-1",
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: null,
    });
    const loop = adaptAgentLoopRun({
      id: "loop-run-1",
      loopId: "loop-1",
      triggerId: null,
      triggerKind: null,
      title: "Release",
      nativeStatus: "running",
      nativeSource: "manual",
      repoOwner: "acme",
      repoName: "shop",
      currentNodeId: "verify",
      stepCount: 2,
      totalStepCount: 4,
      failedStepCount: 0,
      errorKind: null,
      requestId: "request-2",
      workflowRunId: "workflow-2",
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: null,
    });

    expect(background).toMatchObject({
      automation: null,
      automationName: "Deleted automation",
      trigger: {
        id: "trigger-1",
        source: "github",
        kind: "github.issue",
      },
      progress: { currentStepId: null, completedSteps: 0, totalSteps: 1 },
      evidence: {
        sandboxName: "sandbox-1",
        requestId: "request-1",
        workflowRunId: "workflow-1",
        outputUrl: null,
      },
    });
    expect(loop).toMatchObject({
      automation: { source: "agent_loop", sourceId: "loop-1" },
      trigger: { id: null, source: "manual", kind: null },
      progress: {
        currentStepId: "verify",
        completedSteps: 2,
        totalSteps: 4,
      },
      evidence: {
        requestId: "request-2",
        workflowRunId: "workflow-2",
      },
    });
  });
});
