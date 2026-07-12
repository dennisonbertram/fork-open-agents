/**
 * Unit tests for resolveComposioToolsForBgRun's typed outcome contract.
 *
 * Issue #797 (epic #796, T1): replaces the collapsed `{ status: "off" }` /
 * untyped `{ status: "error"; error: string }` shapes with a discriminated
 * union that carries a cause: `reason` on "off", `errorKind`+`message` on
 * "error", and `disconnectedToolkits` on "ready".
 *
 * BT-CT-001: empty slugs -> { status: "off", reason: "no_slugs_selected" },
 *   with no blockedSlugs field.
 * BT-CT-002: repo policy blocks every requested slug -> { status: "off",
 *   reason: "repo_policy_blocked", blockedSlugs: [...] }.
 * BT-CT-003: COMPOSIO_API_KEY not configured -> { status: "error",
 *   errorKind: "composio_missing_api_key", message: <string> } — no more
 *   untyped `error` field.
 * BT-CT-004: ready outcome threads disconnectedToolkits from
 *   resolveComposioToolsForToolkitList instead of discarding it.
 * BT-CT-005 (regression): SDK throw during resolution is caught and reported
 *   as a typed error (errorKind + message), never an untyped `error` string.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// DB mocks
// ---------------------------------------------------------------------------
type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;

const getRepositoryComposioSettings = mock(async () => ({}) as unknown);
const getRepositoryComposioSettingsValues = mock(
  (_settings: unknown): RepoSettingsValues | null => repoSettingsValues,
);

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
}));

// ---------------------------------------------------------------------------
// Drizzle / db.query mocks (backgroundAgentToolSessions cache reads/writes)
// ---------------------------------------------------------------------------
mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      backgroundAgentToolSessions: {
        findFirst: mock(async () => null),
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{ id: "row-1" }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  backgroundAgentToolSessions: {},
}));

mock.module("nanoid", () => ({ nanoid: () => "test-nanoid" }));

// ---------------------------------------------------------------------------
// Composio config / client mocks
// ---------------------------------------------------------------------------
let configured = true;

const getComposioConfig = mock(() => ({
  configured,
  apiKey: configured ? "ak_test_key" : null,
}));

mock.module("@/lib/composio/config", () => ({ getComposioConfig }));

const connectedAccountsListResult: { items: unknown[] } = {
  items: [{ id: "acct-gh-1", toolkit: { slug: "github" }, status: "ACTIVE" }],
};

let composioClientThrows: Error | null = null;

const getComposioClient = mock(() => {
  if (composioClientThrows) {
    throw composioClientThrows;
  }
  return {
    connectedAccounts: {
      list: mock(async () => connectedAccountsListResult),
    },
  };
});

mock.module("@/lib/composio/client", () => ({ getComposioClient }));

mock.module("@/lib/composio/user-id", () => ({
  toComposioUserId: (userId: string) => `composio_${userId}`,
}));

// ---------------------------------------------------------------------------
// resolveComposioToolsForToolkitList mock — allows controlling the "ready"
// outcome (including disconnectedToolkits) per test, and simulating a throw.
// ---------------------------------------------------------------------------
type FakeResolvedTools =
  | {
      status: "ready";
      tools: Record<string, unknown>;
      profile: null;
      composioSessionId: string;
      configHash: string;
      reusedSession: boolean;
      disconnectedToolkits: string[];
    }
  | { status: "off" };

let toolkitListThrows: Error | null = null;
let toolkitListResult: FakeResolvedTools = {
  status: "ready",
  tools: { github_create_issue: { description: "Create a GitHub issue" } },
  profile: null,
  composioSessionId: "session-1",
  configHash: "hash-1",
  reusedSession: false,
  disconnectedToolkits: [],
};

const resolveComposioToolsForToolkitList = mock(async () => {
  if (toolkitListThrows) {
    throw toolkitListThrows;
  }
  return toolkitListResult;
});

mock.module("@/lib/composio/resolve-toolkit-list", () => ({
  resolveComposioToolsForToolkitList,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER all mocks are registered.
// ---------------------------------------------------------------------------
const composioToolsModulePromise = import("./composio-tools");

beforeEach(() => {
  repoSettingsValues = null;
  configured = true;
  composioClientThrows = null;
  toolkitListThrows = null;
  toolkitListResult = {
    status: "ready",
    tools: { github_create_issue: { description: "Create a GitHub issue" } },
    profile: null,
    composioSessionId: "session-1",
    configHash: "hash-1",
    reusedSession: false,
    disconnectedToolkits: [],
  };
  getRepositoryComposioSettingsValues.mockClear();
  resolveComposioToolsForToolkitList.mockClear();
});

describe("resolveComposioToolsForBgRun — typed outcome contract", () => {
  test("rechecks repository policy without re-resolving the cached session", async () => {
    const { assertComposioRepoToolkitsStillAllowed } =
      await composioToolsModulePromise;
    repoSettingsValues = {
      selectedToolkitSlugs: ["github"],
      blockedToolkitSlugs: [],
    };

    await expect(
      assertComposioRepoToolkitsStillAllowed({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "widgets",
        toolkitSlugs: ["github"],
      }),
    ).resolves.toBeUndefined();
    expect(resolveComposioToolsForToolkitList).not.toHaveBeenCalled();

    repoSettingsValues.blockedToolkitSlugs = ["GITHUB"];
    await expect(
      assertComposioRepoToolkitsStillAllowed({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "widgets",
        toolkitSlugs: ["github"],
      }),
    ).rejects.toThrow("github");
    expect(resolveComposioToolsForToolkitList).not.toHaveBeenCalled();
  });

  test("BT-CT-001: empty slugs -> off with reason no_slugs_selected, no blockedSlugs", async () => {
    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: [],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("no_slugs_selected");
      expect(result).not.toHaveProperty("blockedSlugs");
    }
  });

  test("BT-CT-002: repo policy blocks every requested slug -> off with reason repo_policy_blocked and blockedSlugs", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["github", "linear"],
    };

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["github", "linear"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("repo_policy_blocked");
      expect(result.blockedSlugs).toEqual(["github", "linear"]);
    }
  });

  test("BT-CT-002b (#799, finding G2): non-null selectedToolkitSlugs allowlist drops a slug never mentioned by blockedToolkitSlugs", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack"],
      blockedToolkitSlugs: [],
    };

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["slack", "gmail"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    // Today filterSlugsByRepoPolicy only checks blockedToolkitSlugs, so gmail
    // (not in the non-null allowlist) survives unfiltered — this must change.
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.toolkitSlugs).toEqual(["slack"]);
      expect(result.toolkitSlugs).not.toContain("gmail");
    }
  });

  test("BT-CT-002c (#799): allowlist drop is reported via the resolver's off reason when it drops every slug", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack"],
      blockedToolkitSlugs: [],
    };

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["gmail"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("not_in_repo_allowlist");
      expect(result.blockedSlugs).toEqual(["gmail"]);
    }
  });

  test("BT-CT-003: COMPOSIO_API_KEY not configured -> typed error, no untyped error field", async () => {
    configured = false;

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["github"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorKind).toBe("composio_missing_api_key");
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
      // The old untyped shape must be gone.
      expect(result).not.toHaveProperty("error");
    }
  });

  test("BT-CT-004: ready outcome threads disconnectedToolkits from resolveComposioToolsForToolkitList", async () => {
    toolkitListResult = {
      status: "ready",
      tools: { linear_create_issue: { description: "Create a Linear issue" } },
      profile: null,
      composioSessionId: "session-2",
      configHash: "hash-2",
      reusedSession: false,
      disconnectedToolkits: ["linear"],
    };

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["github", "linear"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.disconnectedToolkits).toEqual(["linear"]);
      expect(result.toolkitSlugs).toEqual(["github", "linear"]);
    }
  });

  test("BT-CT-005 (regression): SDK throw during resolution is reported as a typed error, never an untyped error string", async () => {
    toolkitListThrows = new Error("simulated Composio SDK failure");

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["github"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(typeof result.errorKind).toBe("string");
      expect(result.errorKind.length).toBeGreaterThan(0);
      expect(typeof result.message).toBe("string");
      expect(result).not.toHaveProperty("error");
    }
  });
});
