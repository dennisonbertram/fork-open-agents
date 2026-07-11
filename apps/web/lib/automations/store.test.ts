import { describe, expect, mock, test } from "bun:test";
import type { AutomationSourceLoaders } from "./store";
import type { AutomationListItem } from "./types";

mock.module("server-only", () => ({}));

const storeModulePromise = import("./store");

async function listAutomations(
  ...args: Parameters<(typeof import("./store"))["listAutomations"]>
) {
  const store = await storeModulePromise;
  return store.listAutomations(...args);
}

function item(
  sourceId: string,
  overrides: Partial<AutomationListItem> = {},
): AutomationListItem {
  const source = overrides.source ?? "background_agent";
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    kind: source === "agent_loop" ? "multi_step" : "single_step",
    name: sourceId,
    description: null,
    repository: { owner: "Acme", name: "Widgets" },
    nativeStatus: source === "agent_loop" ? "active" : "enabled",
    operability: "active",
    configurationHealth: "valid",
    configurationErrorKind: null,
    observedRevision: {
      contractVersion: 1,
      sourceUpdatedAt: "2026-07-10T00:00:00.000Z",
    },
    stepCount: 1,
    triggers: {
      total: 0,
      enabled: 0,
      kinds: [],
      labels: [],
      nextRunAt: null,
    },
    verification: { configuredStepCount: 0, totalVerifiableSteps: 1 },
    output: { declaredSchemaCount: 0, publishingActionCount: 0 },
    latestRun: null,
    detailUrl: "/detail",
    editUrl: "/edit",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function loaders(params?: {
  background?: AutomationListItem[] | Error;
  loops?: AutomationListItem[] | Error;
  invalidBackground?: number;
  invalidLoops?: number;
}): AutomationSourceLoaders {
  return {
    backgroundAgents: mock(async () => {
      if (params?.background instanceof Error) throw params.background;
      return {
        items: params?.background ?? [],
        invalidItemCount: params?.invalidBackground ?? 0,
      };
    }),
    loops: mock(async () => {
      if (params?.loops instanceof Error) throw params.loops;
      return {
        items: params?.loops ?? [],
        invalidItemCount: params?.invalidLoops ?? 0,
      };
    }),
  };
}

describe("listAutomations", () => {
  test("combines equal source ids without double-counting and sorts deterministically", async () => {
    const deps = loaders({
      background: [item("shared", { name: "Zulu" })],
      loops: [
        item("shared", {
          source: "agent_loop",
          name: "Alpha",
          updatedAt: "2026-07-11T00:00:00.000Z",
        }),
      ],
    });

    const result = await listAutomations(
      { userId: "user-1", filters: {}, loopsEnabled: true },
      deps,
    );

    expect(result.total).toBe(2);
    expect(result.automations.map((automation) => automation.source)).toEqual([
      "agent_loop",
      "background_agent",
    ]);
  });

  test("applies case-insensitive repository, kind, and native-status filters", async () => {
    const deps = loaders({
      background: [item("review")],
      loops: [item("loop", { source: "agent_loop" })],
    });

    const result = await listAutomations(
      {
        userId: "user-1",
        filters: {
          repository: { owner: "acme", name: "widgets" },
          kind: "single_step",
          state: "enabled",
        },
        loopsEnabled: true,
      },
      deps,
    );

    expect(result.automations.map((automation) => automation.sourceId)).toEqual(
      ["review"],
    );
  });

  test("keeps a healthy source visible when the other source fails", async () => {
    const result = await listAutomations(
      { userId: "user-1", filters: {}, loopsEnabled: true },
      loaders({
        background: [item("review")],
        loops: new Error("database-secret-marker"),
      }),
    );

    expect(result.automations).toHaveLength(1);
    expect(result.sourceStatus).toContainEqual({
      source: "agent_loop",
      status: "failed",
      itemCount: 0,
      invalidItemCount: 0,
      errorKind: "source_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("database-secret-marker");
  });

  test("reports invalid items as partial without dropping them", async () => {
    const result = await listAutomations(
      { userId: "user-1", filters: {}, loopsEnabled: true },
      loaders({ background: [item("invalid")], invalidBackground: 1 }),
    );

    expect(result.automations).toHaveLength(1);
    expect(result.sourceStatus[0]).toMatchObject({
      source: "background_agent",
      status: "partial",
      invalidItemCount: 1,
    });
  });

  test("does not call the loop loader when loops are disabled", async () => {
    const deps = loaders({ background: [item("review")] });

    const result = await listAutomations(
      { userId: "user-1", filters: {}, loopsEnabled: false },
      deps,
    );

    expect(deps.loops).not.toHaveBeenCalled();
    expect(result.automations).toHaveLength(1);
    expect(result.sourceStatus[1]).toEqual({
      source: "agent_loop",
      status: "disabled",
      itemCount: 0,
      invalidItemCount: 0,
      errorKind: "feature_disabled",
    });
  });
});
