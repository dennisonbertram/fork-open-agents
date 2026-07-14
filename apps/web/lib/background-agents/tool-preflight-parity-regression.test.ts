/**
 * Cross-path parity regression test (#802, epic #796 T6).
 *
 * The single biggest risk this ticket calls out: computeAgentToolPreflight
 * reimplementing resolution logic instead of composing the SAME shared
 * resolvers resolveComposioToolsForBgRun uses (see A1/A9 precedent —
 * stale/duplicated logic silently drifting from the real execution path).
 *
 * This test runs BOTH functions against IDENTICAL mocked repo-policy and
 * connected-accounts fixtures and asserts their outcomes agree:
 *   - a repo-policy-blocked slug predicted "blocked_by_repo_policy" by
 *     preflight must ALSO be the slug the real resolver's "off" outcome
 *     names in blockedSlugs when every slug is blocked (BT-802-PAR-001),
 *     or excluded from toolkitSlugs when only some are blocked
 *     (BT-802-PAR-002).
 *   - a slug preflight predicts "ready" must be present in the real
 *     resolver's ready toolkitSlugs (BT-802-PAR-002).
 *   - a slug preflight predicts "not_connected" must appear in the real
 *     resolver's disconnectedToolkits (BT-802-PAR-003).
 *
 * If a future change makes computeAgentToolPreflight stop calling
 * applyRepoToolkitPolicy / listComposioConnectedAccounts (e.g. someone
 * "simplifies" it into a hand-rolled status check), this test fails because
 * the two functions' outcomes will diverge for the same fixture.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared DB / Composio mocks — identical fixtures feed both functions.
// ---------------------------------------------------------------------------

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: async () => ({}) as unknown,
  getRepositoryComposioSettingsValues: (
    _settings: unknown,
  ): RepoSettingsValues | null => repoSettingsValues,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      backgroundAgentToolSessions: {
        findFirst: async () => null,
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
  agentLoopToolSessions: {},
  backgroundAgentToolSessions: {},
}));

mock.module("nanoid", () => ({ nanoid: () => "test-nanoid" }));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test" }),
}));

mock.module("@/lib/composio/user-id", () => ({
  toComposioUserId: (userId: string) => `composio_${userId}`,
}));

type FakeAccount = {
  id: string;
  toolkit: { slug: string };
  status: string;
};

let connectedAccounts: FakeAccount[] = [];

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      list: async () => ({ items: connectedAccounts }),
    },
  }),
}));

// resolveComposioToolsForBgRun's own tool-building step (session
// create/reuse) is irrelevant to this parity check — preflight never
// reaches it. Stub it minimally so the real resolver's "ready" path
// completes without hitting the Composio SDK's session API.
//
// toolkitRequiresAuth is also re-exported from this module (#802, Codex
// review on PR #849) — computeAgentToolPreflight imports it from here too.
// None of this file's fixtures use a NO_AUTH toolkit, so it always reports
// "requires auth" (true), matching the real helper's defensive default.
// The NO_AUTH-specific parity case lives in
// tool-preflight-no-auth-parity-regression.test.ts, which does NOT stub
// this module away so the real toolkitRequiresAuth check is exercised.
mock.module("@/lib/composio/resolve-toolkit-list", () => ({
  resolveComposioToolsForToolkitList: async (params: {
    slugs: string[];
    connectedAccountIdsByToolkit: Record<string, string[]>;
  }) => ({
    status: "ready",
    tools: {},
    profile: null,
    composioSessionId: "session-parity",
    configHash: "hash-parity",
    reusedSession: false,
    disconnectedToolkits: params.slugs.filter(
      (slug) => !(params.connectedAccountIdsByToolkit[slug]?.length ?? 0),
    ),
  }),
  toolkitRequiresAuth: async () => true,
}));

// ---------------------------------------------------------------------------
// Import BOTH modules under test AFTER all mocks are registered.
// ---------------------------------------------------------------------------
const composioToolsModulePromise = import("./composio-tools");
const toolPreflightModulePromise = import("./tool-preflight");

beforeEach(() => {
  repoSettingsValues = null;
  connectedAccounts = [];
});

describe("computeAgentToolPreflight parity with resolveComposioToolsForBgRun (#802 regression)", () => {
  test("BT-802-PAR-001: a fully repo-policy-blocked slug agrees on 'blocked' between preflight and the real resolver", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["slack"],
    };

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const realOutcome = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["slack"],
      repoOwner: "acme",
      repoName: "widgets",
    });
    const preflight = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["slack"],
    });

    expect(realOutcome).toEqual({
      status: "off",
      reason: "repo_policy_blocked",
      blockedSlugs: ["slack"],
    });
    expect(preflight.toolkits).toEqual([
      {
        slug: "slack",
        predictedState: "blocked_by_repo_policy",
        policyReason: "repo_policy_blocked",
      },
    ]);
  });

  test("BT-802-PAR-002: a mix of ready + blocked slugs agrees between preflight and the real resolver's ready/blocked split", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["slack"],
    };
    connectedAccounts = [
      { id: "acc-1", toolkit: { slug: "gmail" }, status: "ACTIVE" },
    ];

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const realOutcome = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["gmail", "slack"],
      repoOwner: "acme",
      repoName: "widgets",
    });
    const preflight = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail", "slack"],
    });

    // The real resolver reports gmail as the sole ready toolkit; slack is
    // gated out before reaching tool resolution.
    expect(realOutcome.status).toBe("ready");
    expect(realOutcome.status === "ready" && realOutcome.toolkitSlugs).toEqual([
      "gmail",
    ]);

    const gmailPrediction = preflight.toolkits.find((t) => t.slug === "gmail");
    const slackPrediction = preflight.toolkits.find((t) => t.slug === "slack");
    expect(gmailPrediction?.predictedState).toBe("ready");
    expect(slackPrediction?.predictedState).toBe("blocked_by_repo_policy");
  });

  test("BT-802-PAR-003: a slug with zero connected accounts agrees as 'not connected' between preflight and the real resolver's disconnectedToolkits", async () => {
    connectedAccounts = [];

    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const realOutcome = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["gmail"],
      repoOwner: "acme",
      repoName: "widgets",
    });
    const preflight = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail"],
    });

    expect(realOutcome.status).toBe("ready");
    expect(
      realOutcome.status === "ready" && realOutcome.disconnectedToolkits,
    ).toEqual(["gmail"]);
    expect(preflight.toolkits).toEqual([
      { slug: "gmail", predictedState: "not_connected" },
    ]);
  });
});
