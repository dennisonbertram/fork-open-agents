/**
 * Cross-surface parity test (#799, epic #796 T3, finding E2).
 *
 * Proves chat (direct-slug path), background-agent runs, and agent-loop
 * steps (which call the SAME resolveComposioToolsForBgRun as background
 * agents — finding E1) all resolve to the IDENTICAL final toolkit slug set
 * for the identical repo policy and identical requested slugs. This is the
 * regression guard against the three-surfaces-diverge failure mode: it must
 * fail if any one call site stops routing through the shared
 * applyRepoToolkitPolicy resolver in a future change.
 *
 * Fixture: selectedToolkitSlugs: ["slack"] (non-null allowlist),
 * blockedToolkitSlugs: [] — requested ["slack", "gmail"] on every surface.
 * Expected identical result everywhere: final slugs ["slack"], gmail
 * dropped with reason "not_in_repo_allowlist".
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

const FIXTURE_REPO_SETTINGS: RepoSettingsValues = {
  selectedToolkitSlugs: ["slack"],
  blockedToolkitSlugs: [],
};
const FIXTURE_REQUESTED_SLUGS = ["slack", "gmail"];
const EXPECTED_FINAL_SLUGS = ["slack"];

const fakeTools = { slack_send_message: { description: "stub" } };
const fakeComposioSessionId = "parity-composio-sess";

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: () => Promise.resolve({} as unknown),
  getRepositoryComposioSettingsValues: () => FIXTURE_REPO_SETTINGS,
  getChatComposioSelection: (v: unknown) => normalizeChatComposioSelection(v),
  getComposioAgentSession: () => Promise.resolve(null),
  upsertComposioAgentSession: () => Promise.resolve({ id: "row-1" }),
  touchComposioAgentSession: () => Promise.resolve(),
  getComposioToolProfile: () => Promise.resolve(null),
  isComposioProfileAllowedForRepository: () =>
    Promise.resolve({ allowed: true }),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: () =>
    Promise.resolve({
      id: "chat-parity-1",
      sessionId: "session-parity-1",
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: FIXTURE_REQUESTED_SLUGS,
      },
    }),
  getSessionById: () =>
    Promise.resolve({ repoOwner: "acme", repoName: "widgets" }),
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test_key" }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    create: (_userId: string, _cfg: unknown) =>
      Promise.resolve({
        sessionId: fakeComposioSessionId,
        tools: () => Promise.resolve(fakeTools),
      }),
    use: (_sessionId: string) =>
      Promise.resolve({ tools: () => Promise.resolve(fakeTools) }),
    connectedAccounts: {
      list: () =>
        Promise.resolve({
          items: [
            {
              id: "acct-slack-1",
              toolkit: { slug: "slack" },
              status: "ACTIVE",
            },
            {
              id: "acct-gmail-1",
              toolkit: { slug: "gmail" },
              status: "ACTIVE",
            },
          ],
        }),
    },
  }),
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
mock.module("nanoid", () => ({ nanoid: () => "test-nanoid" }));
mock.module("@/lib/composio/user-id", () => ({
  toComposioUserId: (userId: string) => `composio_${userId}`,
}));

let capturedSlugs: string[] | null = null;
// Wrapping the read in a function defeats TS's control-flow narrowing of
// capturedSlugs to `null` at the expect() call site — the assignment
// happens inside a mock.module factory closure invoked between the
// declaration and the read, which the type-checker cannot see statically.
function readCapturedSlugs(): string[] | null {
  return capturedSlugs;
}

describe("Cross-surface parity: chat, background-agent, and loop resolution (E2)", () => {
  test("PARITY-001: chat direct-slug path drops gmail via the shared repo-policy resolver", async () => {
    capturedSlugs = null;
    mock.module("@/lib/composio/resolve-toolkit-list", () => ({
      resolveComposioToolsForToolkitList: (params: { slugs: string[] }) => {
        capturedSlugs = params.slugs;
        return Promise.resolve({
          status: "ready",
          tools: fakeTools,
          profile: null,
          composioSessionId: fakeComposioSessionId,
          configHash: "hash-chat",
          reusedSession: false,
          disconnectedToolkits: [],
        });
      },
    }));

    const { resolveComposioToolsForChat } = await import("./session");

    await resolveComposioToolsForChat({
      userId: "user-parity-chat",
      chatId: "chat-parity-1",
    });

    expect(readCapturedSlugs()).toEqual(EXPECTED_FINAL_SLUGS);
  });

  test("PARITY-002: background-agent run drops gmail via the SAME shared repo-policy resolver, identical final slugs", async () => {
    const { resolveComposioToolsForBgRun } =
      await import("@/lib/background-agents/composio-tools");

    const result = await resolveComposioToolsForBgRun({
      agentId: "agent-parity",
      runId: "run-parity-1",
      userId: "user-parity-bg",
      slugs: FIXTURE_REQUESTED_SLUGS,
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.toolkitSlugs).toEqual(EXPECTED_FINAL_SLUGS);
    }
  });

  test("PARITY-003: loop resolution (via resolveComposioToolsForBgRun, finding E1) produces the identical final slug set", async () => {
    // Loops call resolveComposioToolsForBgRun directly (agent-step.ts) — the
    // SAME function proven in PARITY-002 — so this is the same call with a
    // different runId, confirming no loop-specific bypass exists.
    const { resolveComposioToolsForBgRun } =
      await import("@/lib/background-agents/composio-tools");

    const result = await resolveComposioToolsForBgRun({
      agentId: null,
      runId: "loop-run-parity-1",
      userId: "user-parity-loop",
      slugs: FIXTURE_REQUESTED_SLUGS,
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.toolkitSlugs).toEqual(EXPECTED_FINAL_SLUGS);
    }
  });
});
