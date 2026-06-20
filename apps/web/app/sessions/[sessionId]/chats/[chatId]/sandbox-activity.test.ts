import { describe, expect, test } from "bun:test";
import type { SessionObservabilityResponse } from "./hooks/use-session-observability";
import { buildSandboxActivitySummary } from "./sandbox-activity";
import type { LifecycleTimingInfo } from "./session-chat-context";

const lifecycle: LifecycleTimingInfo = {
  serverTimeMs: Date.parse("2026-06-19T12:00:00.000Z"),
  clockOffsetMs: 0,
  state: "active",
  lastActivityAtMs: Date.parse("2026-06-19T11:55:00.000Z"),
  hibernateAfterMs: Date.parse("2026-06-19T12:25:00.000Z"),
  sandboxExpiresAtMs: Date.parse("2026-06-19T13:00:00.000Z"),
};

function event(
  id: string,
  overrides: Partial<SessionObservabilityResponse["events"][number]>,
): SessionObservabilityResponse["events"][number] {
  return {
    id,
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    source: "sandbox",
    actorType: "sandbox",
    actorId: null,
    eventName: "sandbox.exec",
    status: "info",
    summary: null,
    requestId: null,
    workflowRunId: null,
    harnessRunId: null,
    sandboxName: null,
    managedRuntimeProfileRunId: null,
    serviceId: null,
    browserRunId: null,
    payload: {},
    redactionStatus: "passed",
    createdAt: "2026-06-19T11:58:00.000Z",
    ...overrides,
  };
}

function observability(
  overrides: Partial<SessionObservabilityResponse>,
): SessionObservabilityResponse {
  return {
    runtimeMode: "classic",
    events: [],
    profileRuns: [],
    workflowRuns: [],
    workers: [],
    directToolUse: {
      observed: false,
      count: 0,
      toolTypes: [],
      toolLabels: [],
      warning: null,
    },
    externalToolUse: { observed: false, count: 0, toolNames: [] },
    services: [],
    browserRuns: [],
    workflowGoals: [],
    workflowArtifacts: [],
    ...overrides,
  };
}

describe("buildSandboxActivitySummary", () => {
  test("prioritizes active worker tool summaries", () => {
    const summary = buildSandboxActivitySummary({
      hasSandboxState: true,
      hasSnapshot: false,
      isSandboxActive: true,
      uiStatusLabel: "Active",
      lifecycleTiming: lifecycle,
      observabilityData: observability({
        workers: [
          {
            id: "worker-1",
            source: "message",
            taskToolCallId: "tool-1",
            workerType: "executor",
            status: "running",
            sandboxName: "session_session-1",
            profileId: null,
            profileVersion: null,
            profileDisplayName: null,
            profileRunId: null,
            currentToolName: "bash",
            currentToolSummary: "Running bun test",
            toolCallCount: 3,
            summary: null,
            updatedAt: "2026-06-19T11:59:00.000Z",
          },
        ],
        directToolUse: {
          observed: true,
          count: 3,
          toolTypes: ["bash"],
          toolLabels: ["bash"],
          warning: null,
        },
      }),
    });

    expect(summary.tone).toBe("busy");
    expect(summary.currentActivity).toBe("Running bun test");
    expect(summary.sandboxName).toBe("session_session-1");
    expect(summary.stats.runningWorkers).toBe(1);
    expect(summary.stats.toolUses).toBe(3);
  });

  test("surfaces warning tone for recent failed sandbox events", () => {
    const summary = buildSandboxActivitySummary({
      hasSandboxState: true,
      hasSnapshot: false,
      isSandboxActive: true,
      uiStatusLabel: "Active",
      lifecycleTiming: lifecycle,
      observabilityData: observability({
        events: [
          event("event-1", {
            status: "failed",
            summary: "Sandbox command failed",
          }),
        ],
      }),
    });

    expect(summary.tone).toBe("warning");
    expect(summary.currentActivity).toBe("Sandbox command failed");
    expect(summary.stats.failedEvents).toBe(1);
  });

  test("keeps paused snapshots inspectable without active sandbox state", () => {
    const summary = buildSandboxActivitySummary({
      hasSandboxState: false,
      hasSnapshot: true,
      isSandboxActive: false,
      uiStatusLabel: "Paused",
      lifecycleTiming: { ...lifecycle, state: "hibernated" },
      observabilityData: null,
    });

    expect(summary.tone).toBe("paused");
    expect(summary.currentActivity).toBe(
      "Sandbox is paused with a saved snapshot.",
    );
    expect(summary.description).toContain("Read-only lifecycle");
  });

  test("filters the recent timeline to sandbox-related events", () => {
    const summary = buildSandboxActivitySummary({
      hasSandboxState: true,
      hasSnapshot: false,
      isSandboxActive: true,
      uiStatusLabel: "Active",
      lifecycleTiming: lifecycle,
      observabilityData: observability({
        events: [
          event("event-1", { source: "chat", eventName: "chat.message" }),
          event("event-2", {
            source: "chat",
            serviceId: "service-1",
            eventName: "service.started",
          }),
          event("event-3", { source: "browser", eventName: "browser.check" }),
        ],
      }),
    });

    expect(summary.recentEvents.map((item) => item.id)).toEqual([
      "event-2",
      "event-3",
    ]);
    expect(summary.stats.events).toBe(2);
  });
});
