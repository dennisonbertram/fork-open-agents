/**
 * #745: createBackgroundAgent/updateBackgroundAgent must persist the new
 * config-surface fields (githubActions, writeScope, requireCiGreenForMerge,
 * modelId) onto the background_agents row.
 *
 * Pure unit tests — DB access is mocked, following the pattern in
 * apps/web/lib/db/agents-crud.test.ts.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Shared state for fake DB ─────────────────────────────────────────────────
let lastAgentInsertValues: Record<string, unknown> | null = null;
let lastAgentUpdateValues: Record<string, unknown> | null = null;
let insertedAgentRow: Record<string, unknown> | null = null;
let updatedAgentRow: Record<string, unknown> | null = null;
let existingAgentRow: Record<string, unknown> | null = null;

function makeTx() {
  return {
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        if (table === "backgroundAgents_table") {
          lastAgentInsertValues = vals as Record<string, unknown>;
        }
        return {
          returning: async () => {
            if (table === "backgroundAgents_table") {
              insertedAgentRow = {
                ...(vals as Record<string, unknown>),
              };
              return [insertedAgentRow];
            }
            // trigger insert
            const triggerInputs = vals as Array<Record<string, unknown>>;
            return triggerInputs;
          },
        };
      },
      onConflictDoNothing: () => ({
        returning: async () => [],
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: unknown) => ({
        where: () => ({
          returning: async () => {
            if (table === "backgroundAgents_table") {
              lastAgentUpdateValues = vals as Record<string, unknown>;
              updatedAgentRow = {
                ...existingAgentRow,
                ...(vals as Record<string, unknown>),
              };
              return [updatedAgentRow];
            }
            return [];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => undefined,
    }),
    query: {
      backgroundAgents: {
        findFirst: async () => existingAgentRow,
      },
      backgroundAgentTriggers: {
        findMany: async () => [],
      },
    },
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    transaction: async (callback: (tx: ReturnType<typeof makeTx>) => unknown) =>
      callback(makeTx()),
  },
}));

mock.module("@/lib/db/schema", () => ({
  backgroundAgents: "backgroundAgents_table",
  backgroundAgentTriggers: "backgroundAgentTriggers_table",
  backgroundAgentToolGrants: "backgroundAgentToolGrants_table",
  backgroundAgentRuns: "backgroundAgentRuns_table",
  backgroundAgentEvents: "backgroundAgentEvents_table",
  backgroundAgentOutputs: "backgroundAgentOutputs_table",
  agentLoops: "agentLoops_table",
}));

mock.module("nanoid", () => ({ nanoid: () => "test-id-123" }));

mock.module("./redaction", () => ({
  redactBackgroundAgentPayload: (payload: unknown) => payload,
}));

mock.module("./matching", () => ({
  triggerMatchesEvent: () => true,
}));

mock.module("./trigger-public-ids", () => ({
  getExistingWebhookPublicIds: () => new Set<string>(),
  getWebhookPublicIdForUpdatedTrigger: () => null,
}));

const { createBackgroundAgent, updateBackgroundAgent } =
  await import("./store");

const baseTrigger = {
  name: "Pull request",
  kind: "github.pull_request" as const,
  status: "enabled" as const,
  conditions: {},
  schedule: null,
};

function baseCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "PR reviewer",
    description: null,
    status: "disabled" as const,
    repoOwner: "dennisonbertram",
    repoName: "fork-open-agents",
    instructions: "Review new pull requests.",
    permissions: {},
    outputMode: "none" as const,
    checkCommand: null,
    composioToolkitSlugs: [],
    githubActions: {
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    },
    writeScope: { mode: "this_repo" as const },
    requireCiGreenForMerge: true,
    modelId: null,
    triggers: [baseTrigger],
    ...overrides,
  };
}

beforeEach(() => {
  lastAgentInsertValues = null;
  lastAgentUpdateValues = null;
  insertedAgentRow = null;
  updatedAgentRow = null;
  existingAgentRow = null;
});

describe("createBackgroundAgent persists the #745 config surface", () => {
  test("persists githubActions, writeScope, requireCiGreenForMerge, modelId defaults", async () => {
    await createBackgroundAgent(
      "user-1",
      baseCreateInput() as Parameters<typeof createBackgroundAgent>[1],
    );

    expect(lastAgentInsertValues).not.toBeNull();
    expect(lastAgentInsertValues?.githubActions).toEqual({
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    });
    expect(lastAgentInsertValues?.writeScope).toEqual({ mode: "this_repo" });
    expect(lastAgentInsertValues?.requireCiGreenForMerge).toBe(true);
    expect(lastAgentInsertValues?.modelId).toBeNull();
  });

  test("persists a non-default writeScope with specific_repos", async () => {
    await createBackgroundAgent(
      "user-1",
      baseCreateInput({
        writeScope: {
          mode: "specific_repos",
          repos: [{ owner: "acme", name: "widgets" }],
        },
      }) as Parameters<typeof createBackgroundAgent>[1],
    );

    expect(lastAgentInsertValues?.writeScope).toEqual({
      mode: "specific_repos",
      repos: [{ owner: "acme", name: "widgets" }],
    });
  });

  test("persists a gateway-format modelId", async () => {
    await createBackgroundAgent(
      "user-1",
      baseCreateInput({
        modelId: "anthropic/claude-opus-4",
      }) as Parameters<typeof createBackgroundAgent>[1],
    );

    expect(lastAgentInsertValues?.modelId).toBe("anthropic/claude-opus-4");
  });
});

describe("updateBackgroundAgent persists the #745 config surface", () => {
  beforeEach(() => {
    existingAgentRow = {
      id: "agent-1",
      userId: "user-1",
      name: "PR reviewer",
      githubActions: {
        open_pull_request: true,
        comment_on_pr_or_issue: true,
      },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      modelId: null,
    };
  });

  test("updates githubActions when provided", async () => {
    await updateBackgroundAgent("user-1", "agent-1", {
      githubActions: { merge_pull_request: true },
    } as Parameters<typeof updateBackgroundAgent>[2]);

    expect(lastAgentUpdateValues?.githubActions).toEqual({
      merge_pull_request: true,
    });
  });

  test("updates writeScope when provided", async () => {
    await updateBackgroundAgent("user-1", "agent-1", {
      writeScope: { mode: "all_repos" },
    } as Parameters<typeof updateBackgroundAgent>[2]);

    expect(lastAgentUpdateValues?.writeScope).toEqual({ mode: "all_repos" });
  });

  test("updates requireCiGreenForMerge when provided", async () => {
    await updateBackgroundAgent("user-1", "agent-1", {
      requireCiGreenForMerge: false,
    } as Parameters<typeof updateBackgroundAgent>[2]);

    expect(lastAgentUpdateValues?.requireCiGreenForMerge).toBe(false);
  });

  test("updates modelId when provided", async () => {
    await updateBackgroundAgent("user-1", "agent-1", {
      modelId: "openai/gpt-5.4",
    } as Parameters<typeof updateBackgroundAgent>[2]);

    expect(lastAgentUpdateValues?.modelId).toBe("openai/gpt-5.4");
  });

  test("omits the new fields from the update set when not provided", async () => {
    await updateBackgroundAgent("user-1", "agent-1", {
      name: "Renamed",
    } as Parameters<typeof updateBackgroundAgent>[2]);

    expect(lastAgentUpdateValues?.githubActions).toBeUndefined();
    expect(lastAgentUpdateValues?.writeScope).toBeUndefined();
    expect(lastAgentUpdateValues?.requireCiGreenForMerge).toBeUndefined();
    expect(lastAgentUpdateValues?.modelId).toBeUndefined();
  });
});
