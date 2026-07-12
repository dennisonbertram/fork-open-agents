/**
 * Regression coverage for the repository dashboard's independent source
 * isolation. The reduced dashboard intentionally no longer renders the old
 * GitHub/Activity windows, but it must retain the same no-cascade guarantee
 * for the canonical Automations and Runs summaries that replace them.
 */
import { describe, expect, mock, test } from "bun:test";
import type { RepositoryDashboardSummaryDependencies } from "./repository-dashboard-summary";

mock.module("server-only", () => ({}));

const { loadRepositoryDashboardSummary } =
  await import("./repository-dashboard-summary");

const input = { userId: "user-1", owner: "acme", repo: "widgets" };

function successfulRuns() {
  return {
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
  };
}

function dependencies(
  overrides: Partial<RepositoryDashboardSummaryDependencies>,
): RepositoryDashboardSummaryDependencies {
  return {
    listAutomations: mock(async () => ({
      total: 2,
      automations: [],
      sourceStatus: [],
      facets: { repositories: [], kinds: [], states: [] },
    })),
    listRuns: mock(async () => successfulRuns()),
    ...overrides,
  };
}

describe("repository dashboard partial-failure isolation", () => {
  test("an Automation summary failure does not hide the Runs summary", async () => {
    const result = await loadRepositoryDashboardSummary(
      input,
      dependencies({
        listAutomations: mock(async () => {
          throw new Error("Automations DB unavailable");
        }),
      }),
    );

    expect(result.automations).toEqual({ status: "error" });
    expect(result.runs).toEqual({ status: "ready", count: 0 });
  });

  test("a Runs summary failure does not hide the Automation summary", async () => {
    const result = await loadRepositoryDashboardSummary(
      input,
      dependencies({
        listRuns: mock(async () => {
          throw new Error("Runs DB unavailable");
        }),
      }),
    );

    expect(result.automations).toEqual({ status: "ready", count: 2 });
    expect(result.runs).toEqual({ status: "error" });
  });
});
