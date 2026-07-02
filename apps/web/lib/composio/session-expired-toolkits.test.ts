/**
 * Tests for expiredToolkits on resolveComposioToolsForChat's direct-list
 * branch (issue #800).
 *
 * Behavior contract: a selected toolkit whose ONLY connected account(s) are
 * all EXPIRED (not "zero accounts at all", which stays in
 * disconnectedToolkits) must be surfaced distinctly via expiredToolkits, so
 * the UI/chat can say "expired — reconnect" instead of "not connected".
 *
 * Computed from the SAME shared connected-accounts helper call as
 * disconnectedToolkits/connectedAccountIdsByToolkit — no second SDK
 * round-trip.
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

const fakeTools = { github_get_repo: { description: "stub" } };
const fakeComposioSessionId = "expired-toolkits-composio-sess";

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: () => Promise.resolve(undefined),
  getRepositoryComposioSettingsValues: () => null,
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
      id: "chat-expired-1",
      sessionId: "session-expired-1",
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: ["slack", "gmail", "linear"],
      },
    }),
  getSessionById: () => Promise.resolve({ repoOwner: null, repoName: null }),
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true }),
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
      // slack: only an EXPIRED account (should be "expired", not "disconnected")
      // gmail: no accounts at all (should be "disconnected", not "expired")
      // linear: an ACTIVE account (neither expired nor disconnected)
      list: (_params: unknown) =>
        Promise.resolve({
          items: [
            { id: "ca_slack", status: "EXPIRED", toolkit: { slug: "slack" } },
            {
              id: "ca_linear",
              status: "ACTIVE",
              toolkit: { slug: "linear" },
            },
          ],
        }),
    },
  }),
}));

describe("resolveComposioToolsForChat — expiredToolkits (#800)", () => {
  test("a toolkit with only an EXPIRED account is reported in expiredToolkits, not disconnectedToolkits", async () => {
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1",
      chatId: "chat-expired-1",
      agentKey: "main",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.expiredToolkits ?? []).toContain("slack");
      expect(result.disconnectedToolkits ?? []).not.toContain("slack");
    }
  });

  test("a toolkit with zero accounts at all is reported in disconnectedToolkits, not expiredToolkits", async () => {
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1",
      chatId: "chat-expired-1",
      agentKey: "main",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.disconnectedToolkits ?? []).toContain("gmail");
      expect(result.expiredToolkits ?? []).not.toContain("gmail");
    }
  });

  test("a toolkit with an ACTIVE account is in neither list", async () => {
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1",
      chatId: "chat-expired-1",
      agentKey: "main",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.expiredToolkits ?? []).not.toContain("linear");
      expect(result.disconnectedToolkits ?? []).not.toContain("linear");
    }
  });
});
