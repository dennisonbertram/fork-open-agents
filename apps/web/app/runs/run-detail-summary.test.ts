import { describe, expect, test } from "bun:test";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type { BackgroundRunDetailData } from "@/app/background-runs/[runId]/types";
import {
  buildBackgroundRunDetailSummary,
  buildLoopRunDetailSummary,
} from "./run-detail-summary";

describe("Run detail summary adapters", () => {
  test("background framing exposes safe normalized evidence but no prompt, token, or config", () => {
    const data = {
      run: {
        id: "run-1",
        status: "running",
        source: "github",
        triggerId: "trigger-1",
        triggerKind: "github.pull_request",
        externalId: "delivery-1",
        idempotencyKey: "key-1",
        repoOwner: "acme",
        repoName: "shop",
        ref: null,
        sha: null,
        branch: null,
        prNumber: 1,
        issueNumber: null,
        deploymentUrl: null,
        outputUrl: null,
        sandboxName: "sandbox-1",
        requestId: "request-1",
        workflowRunId: "workflow-1",
        errorKind: null,
        errorMessage: "token=raw-secret",
        createdAt: "2026-07-11T10:00:00.000Z",
        updatedAt: "2026-07-11T10:00:00.000Z",
        startedAt: "2026-07-11T10:01:00.000Z",
        finishedAt: null,
      },
      agent: {
        id: "agent-1",
        name: "Review PRs",
        permissions: { token: "raw-secret", prompt: "private prompt" },
        checkCommand: "curl https://secret.invalid",
      },
      events: [
        {
          id: "event-1",
          eventName: "private.event",
          status: "running",
          summary: "private prompt",
          workflowRunId: null,
          sandboxName: null,
          requestId: null,
          errorKind: null,
          redactionStatus: "passed",
          payload: { token: "raw-secret" },
          createdAt: "2026-07-11T10:01:00.000Z",
        },
      ],
      outputs: [],
    } satisfies BackgroundRunDetailData;

    const summary = buildBackgroundRunDetailSummary(data, {
      now: new Date("2026-07-11T18:00:00.000Z"),
    });
    const serialized = JSON.stringify(summary);

    expect(summary.automation.name).toBe("Review PRs");
    expect(summary.evidence.workflowRunId).toBe("workflow-1");
    expect(summary.health).toBe("needs_attention");
    expect(summary.attentionReasons).toContain("stale");
    expect(serialized).not.toContain("raw-secret");
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("curl");
  });

  test("loop framing preserves native status and typed attention without context leakage", () => {
    const data = {
      run: {
        id: "run-2",
        loopId: "loop-1",
        userId: "user-1",
        status: "stalled",
        definitionSnapshot: { nodes: [], edges: [] },
        currentNodeId: "verify",
        currentStepRunId: null,
        iterationCount: 1,
        stepCount: 2,
        context: { prompt: "private loop prompt", token: "raw-token" },
        source: "schedule",
        triggerId: "trigger-1",
        idempotencyKey: "key-2",
        errorKind: null,
        errorMessage: null,
        workflowRunId: "workflow-2",
        requestId: "request-2",
        startedAt: new Date("2026-07-11T10:01:00.000Z"),
        finishedAt: null,
        createdAt: new Date("2026-07-11T10:00:00.000Z"),
        updatedAt: new Date("2026-07-11T10:02:00.000Z"),
      },
      loop: {
        id: "loop-1",
        name: "Release safely",
        repoOwner: "acme",
        repoName: "shop",
        guardrails: { maxIterations: 3 },
      },
      steps: [],
      events: [],
      watchdogRuns: [],
    } satisfies GetAgentLoopRunDetailResponse;

    const summary = buildLoopRunDetailSummary(data);
    const serialized = JSON.stringify(summary);

    expect(summary.nativeStatus).toBe("stalled");
    expect(summary.attentionReasons).toContain("stalled");
    expect(serialized).not.toContain("private loop prompt");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("maxIterations");
    expect(summary.automation.href).toBe("/loops/loop-1");
    expect(
      buildLoopRunDetailSummary(data, { variant: "canonical" }).automation.href,
    ).toBe("/automations/agent-loop/loop-1");
  });

  test("queued loops use the same stale attention window as the Runs list", () => {
    const data = {
      run: {
        id: "run-3",
        loopId: "loop-1",
        userId: "user-1",
        status: "queued",
        definitionSnapshot: { nodes: [], edges: [] },
        currentNodeId: null,
        currentStepRunId: null,
        iterationCount: 0,
        stepCount: 0,
        context: {},
        source: "manual",
        triggerId: null,
        idempotencyKey: "key-3",
        errorKind: null,
        errorMessage: null,
        workflowRunId: null,
        requestId: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date("2026-07-11T10:00:00.000Z"),
        updatedAt: new Date("2026-07-11T10:00:00.000Z"),
      },
      loop: {
        id: "loop-1",
        name: "Release safely",
        repoOwner: "acme",
        repoName: "shop",
        guardrails: null,
      },
      steps: [],
      events: [],
      watchdogRuns: [],
    } satisfies GetAgentLoopRunDetailResponse;

    const summary = buildLoopRunDetailSummary(data, {
      now: new Date("2026-07-11T18:00:00.000Z"),
    });

    expect(summary.health).toBe("needs_attention");
    expect(summary.attentionReasons).toEqual(["stale"]);
  });
});
