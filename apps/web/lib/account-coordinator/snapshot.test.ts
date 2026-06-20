import { describe, expect, test } from "bun:test";
import {
  buildAccountSnapshot,
  normalizeBackgroundAgentRun,
  normalizeSession,
  type BackgroundAgentRunRow,
  type SessionRow,
} from "./snapshot";

const now = new Date("2026-06-20T12:00:00.000Z");

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    title: "Fix checkout",
    status: "running",
    repoOwner: "acme",
    repoName: "shop",
    branch: "main",
    lifecycleState: "active",
    lifecycleError: null,
    prNumber: null,
    prStatus: null,
    createdAt: new Date("2026-06-20T10:00:00.000Z"),
    updatedAt: new Date("2026-06-20T11:00:00.000Z"),
    ...overrides,
  };
}

function backgroundRunRow(
  overrides: Partial<BackgroundAgentRunRow> = {},
): BackgroundAgentRunRow {
  return {
    id: "bg-run-1",
    agentName: "Release watcher",
    status: "failed",
    source: "github",
    triggerKind: "github.pull_request",
    repoOwner: "acme",
    repoName: "shop",
    branch: "feature",
    prNumber: 12,
    issueNumber: null,
    errorKind: "tool_failed",
    errorMessage: "token=ghp_secret should not leak",
    outputUrl: null,
    payloadSummary: {
      title: "Secret task",
      actor: "dennison",
      stdout: "raw",
    },
    createdAt: new Date("2026-06-20T09:00:00.000Z"),
    updatedAt: new Date("2026-06-20T09:30:00.000Z"),
    startedAt: new Date("2026-06-20T09:00:00.000Z"),
    finishedAt: new Date("2026-06-20T09:30:00.000Z"),
    ...overrides,
  };
}

describe("account coordinator snapshot", () => {
  test("normalizes running, stale, completed, and needs-attention items", async () => {
    const snapshot = await buildAccountSnapshot({
      userId: "user-1",
      window: "24h",
      now,
      loaders: {
        sessions: async () => [
          sessionRow(),
          sessionRow({
            id: "session-stale",
            updatedAt: new Date("2026-06-20T01:00:00.000Z"),
          }),
        ],
        chatWorkflowRuns: async () => [
          {
            id: "workflow-1",
            chatId: "chat-1",
            chatTitle: "Build report",
            sessionId: "session-1",
            sessionTitle: "Fix checkout",
            status: "completed",
            runtimeMode: "classic",
            errorMessage: null,
            startedAt: new Date("2026-06-20T08:00:00.000Z"),
            finishedAt: new Date("2026-06-20T08:01:00.000Z"),
            createdAt: new Date("2026-06-20T08:00:00.000Z"),
          },
        ],
        backgroundAgentRuns: async () => [backgroundRunRow()],
        agentLoopRuns: async () => [
          {
            id: "loop-run-1",
            loopName: "Deploy loop",
            status: "paused",
            source: "manual",
            repoOwner: "acme",
            repoName: "shop",
            currentNodeId: "approval",
            stepCount: 3,
            errorKind: null,
            errorMessage: null,
            createdAt: new Date("2026-06-20T07:00:00.000Z"),
            updatedAt: new Date("2026-06-20T07:30:00.000Z"),
            startedAt: new Date("2026-06-20T07:00:00.000Z"),
            finishedAt: null,
          },
        ],
        scheduledAgents: async () => [
          {
            id: "agent-1",
            name: "Morning check",
            source: "background_agent",
            status: "enabled",
            repo: { owner: "acme", name: "shop" },
            nextRunAt: "2026-06-21T12:00:00.000Z",
            triggerKind: "schedule.cron",
          },
        ],
      },
    });

    expect(snapshot.window.hours).toBe(24);
    expect(snapshot.running.map((item) => item.id)).toEqual(["session-1"]);
    expect(snapshot.stale.map((item) => item.id)).toEqual(["session-stale"]);
    expect(snapshot.waitingOnUser.map((item) => item.id)).toEqual([
      "loop-run-1",
    ]);
    expect(snapshot.recentlyCompleted.map((item) => item.id)).toContain(
      "workflow-1",
    );
    expect(snapshot.needsAttention.map((item) => item.id)).toEqual([
      "bg-run-1",
      "loop-run-1",
      "session-stale",
    ]);
    expect(snapshot.scheduledAgents).toHaveLength(1);
    expect(snapshot.sourceStatus).toContainEqual(
      expect.objectContaining({
        source: "scheduled_agents",
        status: "ok",
        itemCount: 1,
      }),
    );
    expect(
      snapshot.sourceStatus.every((source) => source.status === "ok"),
    ).toBe(true);
  });

  test("keeps partial source failures bounded and reports source status", async () => {
    const snapshot = await buildAccountSnapshot({
      userId: "user-1",
      window: "bad",
      now,
      loaders: {
        sessions: async () => [sessionRow()],
        chatWorkflowRuns: async () => {
          throw new Error("database password=secret exploded");
        },
        backgroundAgentRuns: async () => [],
        agentLoopRuns: async () => [],
        scheduledAgents: async () => [],
      },
    });

    expect(snapshot.window.hours).toBe(24);
    expect(snapshot.running.map((item) => item.id)).toEqual(["session-1"]);
    expect(snapshot.sourceStatus).toContainEqual({
      source: "chat_workflow",
      status: "failed",
      itemCount: 0,
      error: "[redacted]",
    });
  });

  test("dedupes related attention items by repo branch and preserves related source metadata", async () => {
    const snapshot = await buildAccountSnapshot({
      userId: "user-1",
      window: "24h",
      now,
      loaders: {
        sessions: async () => [
          sessionRow({
            id: "session-failed",
            status: "failed",
            branch: "feature",
            lifecycleState: "failed",
            lifecycleError: "failed",
            updatedAt: new Date("2026-06-20T09:40:00.000Z"),
          }),
        ],
        chatWorkflowRuns: async () => [],
        backgroundAgentRuns: async () => [backgroundRunRow({ prNumber: null })],
        agentLoopRuns: async () => [],
        scheduledAgents: async () => [],
      },
    });

    expect(snapshot.needsAttention.map((item) => item.id)).toEqual([
      "session-failed",
    ]);
    expect(snapshot.needsAttention[0]?.metadata).toMatchObject({
      relatedItemCount: 1,
      relatedSources: "background_agent",
    });
  });

  test("normalizers redact summaries and metadata", () => {
    expect(normalizeBackgroundAgentRun(backgroundRunRow(), now).summary).toBe(
      "Background agent run failed: tool_failed",
    );

    expect(
      normalizeSession(
        sessionRow({
          lifecycleError:
            "raw stderr and prompt fragments should not reach the snapshot",
        }),
        now,
      ).summary,
    ).toBe("Session failed");
  });
});
