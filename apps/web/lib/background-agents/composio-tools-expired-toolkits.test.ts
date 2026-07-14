/**
 * Tests for expiredToolkits on resolveComposioToolsForBgRun's "ready" outcome
 * (issue #800) — parallel to disconnectedToolkits, computed from the SAME
 * shared connected-accounts fetch (not a second SDK round-trip).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let repoSettingsValues: {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
} | null = null;

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: mock(async () => ({}) as unknown),
  getRepositoryComposioSettingsValues: mock(() => repoSettingsValues),
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      backgroundAgentToolSessions: { findFirst: mock(async () => null) },
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{ id: "row-1" }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoopToolSessions: {},
  backgroundAgentToolSessions: {},
}));
mock.module("nanoid", () => ({ nanoid: () => "test-nanoid" }));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test_key" }),
}));

// slack: only an EXPIRED account → expiredToolkits, NOT disconnectedToolkits
// gmail: zero accounts at all → disconnectedToolkits (resolveComposioToolsForToolkitList's
//   own no-ACTIVE-account logic), NOT expiredToolkits
// github: an ACTIVE account → neither
const connectedAccountsListResult = {
  items: [
    { id: "ca_slack", toolkit: { slug: "slack" }, status: "EXPIRED" },
    { id: "ca_github", toolkit: { slug: "github" }, status: "ACTIVE" },
  ],
};

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      list: mock(async () => connectedAccountsListResult),
    },
    create: mock(async () => ({
      sessionId: "composio-session-1",
      tools: async () => ({}),
    })),
    use: mock(async () => ({ tools: async () => ({}) })),
    toolkits: { get: mock(async () => ({ authConfigDetails: [] })) },
  }),
}));

mock.module("@/lib/composio/user-id", () => ({
  toComposioUserId: (userId: string) => `composio_${userId}`,
}));

describe("resolveComposioToolsForBgRun — expiredToolkits (#800)", () => {
  beforeEach(() => {
    repoSettingsValues = null;
  });

  test("a selected toolkit with only an EXPIRED account is reported in expiredToolkits, not disconnectedToolkits", async () => {
    const { resolveComposioToolsForBgRun } = await import("./composio-tools");

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["slack", "gmail", "github"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.expiredToolkits ?? []).toContain("slack");
      expect(result.disconnectedToolkits).not.toContain("slack");
      expect(result.disconnectedToolkits).toContain("gmail");
      expect(result.expiredToolkits ?? []).not.toContain("gmail");
    }
  });
});
