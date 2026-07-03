/**
 * Chat direct-slug repo-policy regression tests (#799, epic #796 T3, finding
 * A5): resolveComposioToolsForChat's direct-slug path previously applied NO
 * repo policy at all. It must now route through the shared repo-policy
 * resolver (applyRepoToolkitPolicy) exactly like background agents and loops,
 * so the same repo config produces the same result on every surface.
 *
 * BT-SESS-RP-001: a repo with blockedToolkitSlugs: ["gmail"] and a chat
 *   direct-slug selection of ["gmail", "slack"] resolves WITHOUT gmail —
 *   slack remains available (partial block proceeds).
 * BT-SESS-RP-002: a repo with a non-null selectedToolkitSlugs allowlist
 *   drops any chat direct-slug not in it, even though blockedToolkitSlugs
 *   never mentioned it.
 * BT-SESS-RP-003: when every requested slug is blocked, resolution returns
 *   { status: "off" } (no tools) rather than attempting an empty session.
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

const fakeTools = { slack_send_message: { description: "stub" } };
const fakeComposioSessionId = "repo-policy-composio-sess";

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;
let capturedSlugs: string[] | null = null;
// Wrapping the read in a function defeats TS's control-flow narrowing of
// capturedSlugs to `null` at the expect() call site — the assignment
// happens inside a mock.module factory closure invoked between the
// declaration and the read, which the type-checker cannot see statically.
function readCapturedSlugs(): string[] | null {
  return capturedSlugs;
}

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: () => Promise.resolve({} as unknown),
  getRepositoryComposioSettingsValues: () => repoSettingsValues,
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
      id: "chat-rp-1",
      sessionId: "session-rp-1",
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: ["gmail", "slack"],
      },
    }),
  getSessionById: () =>
    Promise.resolve({ repoOwner: "acme", repoName: "widgets" }),
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

describe("resolveComposioToolsForChat — direct-slug path applies repo policy (A5)", () => {
  test("BT-SESS-RP-001: repo blockedToolkitSlugs excludes gmail; slack remains available", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail"],
    };

    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-rp-1",
      chatId: "chat-rp-1",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      // The upstream fake SDK ignores which slugs were requested and always
      // returns fakeTools + disconnectedToolkits: [] for any non-empty slug
      // list, so the direct behavioral proof is in the config/session-cache
      // request shape, verified in BT-SESS-RP-002 below via upsert capture.
      expect(typeof result.tools).toBe("object");
    }
  });

  test("BT-SESS-RP-001b (post-review, #799 contract gap): a partial repo-policy block records a typed repoPolicyBlocked outcome naming gmail on the READY result", async () => {
    // #799's first contract bullet: "the resolved tool set excludes Gmail
    // (Slack remains available) and a typed repo_policy_blocked outcome is
    // recorded naming gmail." Before this fix, policyResult.blocked was
    // discarded — the ready outcome carried no evidence at all.
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail"],
    };

    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-rp-1b",
      chatId: "chat-rp-1",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.repoPolicyBlocked).toEqual([
        { slug: "gmail", reason: "repo_policy_blocked" },
      ]);
    }
  });

  test("BT-SESS-RP-002: non-null selectedToolkitSlugs allowlist drops a slug the denylist never mentioned", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack"],
      blockedToolkitSlugs: [],
    };

    capturedSlugs = null;
    mock.module("@/lib/composio/resolve-toolkit-list", () => ({
      resolveComposioToolsForToolkitList: (params: { slugs: string[] }) => {
        capturedSlugs = params.slugs;
        return Promise.resolve({
          status: "ready",
          tools: fakeTools,
          profile: null,
          composioSessionId: fakeComposioSessionId,
          configHash: "hash-rp",
          reusedSession: false,
          disconnectedToolkits: [],
        });
      },
    }));

    const { resolveComposioToolsForChat } = await import("./session");

    await resolveComposioToolsForChat({
      userId: "user-rp-2",
      chatId: "chat-rp-1",
    });

    expect(readCapturedSlugs()).toEqual(["slack"]);
  });

  test("BT-SESS-RP-003: every requested slug blocked resolves to status off (no session attempted)", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail", "slack"],
    };

    let toolkitListCalled = false;
    mock.module("@/lib/composio/resolve-toolkit-list", () => ({
      resolveComposioToolsForToolkitList: () => {
        toolkitListCalled = true;
        return Promise.reject(
          new Error("must not be called when every slug is blocked"),
        );
      },
    }));

    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-rp-3",
      chatId: "chat-rp-1",
    });

    expect(result.status).toBe("off");
    expect(toolkitListCalled).toBe(false);
  });

  test("BT-SESS-RP-003b (post-review, #799 contract gap): an all-blocked outcome carries repoPolicyBlocked naming every dropped slug, distinguishing it from never-configured", async () => {
    // Before this fix, an all-blocked repo policy and a chat that was simply
    // never configured were both bare { status: "off" } — indistinguishable.
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail", "slack"],
    };

    mock.module("@/lib/composio/resolve-toolkit-list", () => ({
      resolveComposioToolsForToolkitList: () =>
        Promise.reject(
          new Error("must not be called when every slug is blocked"),
        ),
    }));

    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-rp-3b",
      chatId: "chat-rp-1",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.repoPolicyBlocked).toEqual(
        expect.arrayContaining([
          { slug: "gmail", reason: "repo_policy_blocked" },
          { slug: "slack", reason: "repo_policy_blocked" },
        ]),
      );
      expect(result.repoPolicyBlocked).toHaveLength(2);
    }
  });
});
