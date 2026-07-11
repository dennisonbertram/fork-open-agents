import { describe, expect, mock, test } from "bun:test";
import type { RepositoryDashboardSummaryDependencies } from "./repository-dashboard-summary";

mock.module("server-only", () => ({}));

const { loadRepositoryDashboardSummary } =
  await import("./repository-dashboard-summary");

function dependencies(
  overrides: Partial<RepositoryDashboardSummaryDependencies> = {},
): RepositoryDashboardSummaryDependencies {
  return {
    listAutomations: mock(async () => ({
      total: 3,
      automations: [],
      sourceStatus: [
        {
          source: "background_agent" as const,
          status: "ok" as const,
          itemCount: 3,
          invalidItemCount: 0,
          errorKind: null,
        },
      ],
      facets: { repositories: [], kinds: [], states: [] },
    })),
    listRuns: mock(async () => ({
      requestId: "request-1",
      generatedAt: "2026-07-11T00:00:00.000Z",
      items: [],
      sourceStatus: [
        {
          source: "background_agent" as const,
          status: "ok" as const,
          itemCount: 0,
        },
        { source: "agent_loop" as const, status: "ok" as const, itemCount: 0 },
      ],
      allSourcesFailed: false,
    })),
    ...overrides,
  };
}

const input = { userId: "user-1", owner: "acme", repo: "widgets" };

describe("loadRepositoryDashboardSummary", () => {
  test("uses unified owner-scoped Automation and Run contracts", async () => {
    const deps = dependencies();
    const result = await loadRepositoryDashboardSummary(input, deps);

    expect(deps.listAutomations).toHaveBeenCalledWith({
      userId: "user-1",
      filters: { repository: { owner: "acme", name: "widgets" } },
    });
    expect(deps.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        filters: { view: "all", repoOwner: "acme", repoName: "widgets" },
        limit: 5,
      }),
    );
    expect(result).toEqual({
      automations: { status: "ready", count: 3 },
      runs: { status: "ready", count: 0 },
    });
  });

  test("keeps Runs truthful when Automations fail independently", async () => {
    const result = await loadRepositoryDashboardSummary(
      input,
      dependencies({
        listAutomations: mock(async () => {
          throw new Error("automation source unavailable");
        }),
      }),
    );

    expect(result).toEqual({
      automations: { status: "error" },
      runs: { status: "ready", count: 0 },
    });
  });

  test("keeps Automations truthful when Runs fail independently", async () => {
    const result = await loadRepositoryDashboardSummary(
      input,
      dependencies({
        listRuns: mock(async () => {
          throw new Error("run source unavailable");
        }),
      }),
    );

    expect(result).toEqual({
      automations: { status: "ready", count: 3 },
      runs: { status: "error" },
    });
  });

  test("labels partial unified source responses instead of claiming complete counts", async () => {
    const result = await loadRepositoryDashboardSummary(
      input,
      dependencies({
        listAutomations: mock(async () => ({
          total: 2,
          automations: [],
          sourceStatus: [
            {
              source: "background_agent" as const,
              status: "failed" as const,
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable" as const,
            },
          ],
          facets: { repositories: [], kinds: [], states: [] },
        })),
        listRuns: mock(async () => ({
          requestId: "request-1",
          generatedAt: "2026-07-11T00:00:00.000Z",
          items: [{ id: "background_agent:run-1" }] as never[],
          sourceStatus: [
            {
              source: "background_agent" as const,
              status: "failed" as const,
              itemCount: 0,
              safeErrorKind: "source_unavailable" as const,
            },
            {
              source: "agent_loop" as const,
              status: "ok" as const,
              itemCount: 1,
            },
          ],
          allSourcesFailed: false,
        })),
      }),
    );

    expect(result).toEqual({
      automations: { status: "partial", count: 2 },
      runs: { status: "partial", count: 1 },
    });
  });
});
