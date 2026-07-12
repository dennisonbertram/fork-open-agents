import { describe, expect, mock, test } from "bun:test";
import { listAutomationRuns } from "./list";
import type { NormalizedAutomationRun } from "./types";

function run(
  source: "background_agent" | "agent_loop",
  id: string,
  createdAt: string,
): NormalizedAutomationRun {
  return {
    id: `${source}:${id}`,
    source,
    sourceId: id,
    nativeStatus: "running",
    nativeSource: "manual",
    title: id,
    state: "running",
    outcome: null,
    health: "ok",
    attentionReasons: [],
    repository: { owner: "acme", name: "shop" },
    detailUrl:
      source === "background_agent"
        ? `/background-runs/${id}`
        : `/loops/loop-1/runs/${id}`,
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      finishedAt: null,
    },
    metadata: {},
    automation:
      source === "background_agent"
        ? { source, sourceId: "agent-1" }
        : { source, sourceId: "loop-1" },
    automationName: id,
    trigger: { id: null, source: "manual", kind: null },
    progress: { currentStepId: null, completedSteps: 0, totalSteps: 1 },
    evidence: {
      requestId: null,
      workflowRunId: null,
      sandboxName: null,
      outputUrl: null,
    },
  };
}

describe("unified Runs list", () => {
  test("sorts source collisions stably and returns a keyset cursor", async () => {
    const background = mock(async () => [
      run("background_agent", "same", "2026-07-11T12:00:00.000Z"),
      run("background_agent", "older", "2026-07-11T10:00:00.000Z"),
    ]);
    const loops = mock(async () => [
      run("agent_loop", "same", "2026-07-11T12:00:00.000Z"),
    ]);

    const result = await listAutomationRuns({
      requestId: "request-1",
      filters: { view: "all" },
      limit: 2,
      loaders: { background_agent: background, agent_loop: loops },
      now: new Date("2026-07-11T13:00:00.000Z"),
    });

    expect(result.items.map((item) => item.id)).toEqual([
      "background_agent:same",
      "agent_loop:same",
    ]);
    expect(result.nextCursor).toBeDefined();
    expect(result.sourceStatus).toEqual([
      { source: "background_agent", status: "ok", itemCount: 2 },
      { source: "agent_loop", status: "ok", itemCount: 1 },
    ]);
  });

  test("keeps a healthy source visible and suppresses pagination when the other fails", async () => {
    const result = await listAutomationRuns({
      requestId: "request-2",
      filters: { view: "attention", repoOwner: "acme", repoName: "shop" },
      limit: 25,
      loaders: {
        background_agent: async () => {
          throw new Error("database address must not escape");
        },
        agent_loop: async () => [
          run("agent_loop", "loop-run", "2026-07-11T12:00:00.000Z"),
        ],
      },
      now: new Date("2026-07-11T13:00:00.000Z"),
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
    expect(result.allSourcesFailed).toBe(false);
    expect(result.sourceStatus[0]).toEqual({
      source: "background_agent",
      status: "failed",
      itemCount: 0,
      safeErrorKind: "source_unavailable",
    });
  });

  test("reports total source failure without exposing raw errors", async () => {
    const result = await listAutomationRuns({
      requestId: "request-total-failure",
      filters: { view: "all" },
      limit: 25,
      loaders: {
        background_agent: async () => {
          throw new Error("postgres://private-host/background");
        },
        agent_loop: async () => {
          throw new Error("postgres://private-host/loops");
        },
      },
    });

    expect(result.allSourcesFailed).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
    expect(result.sourceStatus).toEqual([
      {
        source: "background_agent",
        status: "failed",
        itemCount: 0,
        safeErrorKind: "source_unavailable",
      },
      {
        source: "agent_loop",
        status: "failed",
        itemCount: 0,
        safeErrorKind: "source_unavailable",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-host");
  });

  test("passes owner-independent filters to only the selected Automation source", async () => {
    const background = mock(async () => []);
    const loops = mock(async () => []);
    const filters = {
      view: "completed" as const,
      automationSource: "agent_loop" as const,
      automationId: "loop-42",
      triggerKind: "github.issue",
    };

    await listAutomationRuns({
      requestId: "request-3",
      filters,
      limit: 10,
      loaders: { background_agent: background, agent_loop: loops },
    });

    expect(background).not.toHaveBeenCalled();
    expect(loops).toHaveBeenCalledWith(
      expect.objectContaining({ filters, limit: 11 }),
    );
  });
});
