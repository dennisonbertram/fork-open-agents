/**
 * Regression tests for #1119: an IMPLICIT repo-default Composio selection
 * (GitHub default-on for an unconfigured repo, `apps/web/lib/composio/
 * session.ts` `resolveRepoSelectedSlugs`) must not hard-fail a
 * managed-runtime chat. An EXPLICIT selection (chat-level directSlugs or
 * mainProfileId, OR a saved repo-level selectedToolkitSlugs in workspace
 * settings) must still throw, since silently dropping tools a user
 * deliberately chose is worse than a clear error.
 *
 * Covers the five cases from #1119, plus case 6 from the PR #1120 P2 review
 * follow-up (repo tier itself splits into implicit vs. explicit):
 *   1. managed runtime + nothing explicit + GitHub connected -> no Composio
 *      tools, no throw.
 *   2. managed runtime + explicit chat mainProfileId -> still throws.
 *   3. managed runtime + explicit chat directToolkitSlugs -> still throws.
 *   4. classic + nothing explicit + GitHub connected -> still gets
 *      ["github"] (default-on preserved where it works).
 *   5. the explicit-off sentinel ({directToolkitSlugs: []}) still
 *      short-circuits, even in managed runtime mode.
 *   6. managed runtime + SAVED non-null repo-level selectedToolkitSlugs
 *      (workspace settings) -> still throws, like chat/agent explicit
 *      selections. This is the case the P2 review comment on
 *      apps/web/lib/composio/session.ts:318 identified as missing: a saved
 *      repo selection is an explicit choice, not the implicit GitHub
 *      default-on, and must not be silently dropped.
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

const fakeTools = { github_get_repo: {} };

function mockDb(
  chatSelection: {
    mainProfileId: string | null;
    // Omit the key entirely for "never set" — the real input schema is
    // .strict() with directToolkitSlugs typed array-or-undefined (not
    // array-or-null). Passing an explicit null fails schema validation and
    // silently falls back to the all-defaults selection, masking whatever
    // case is under test.
    directToolkitSlugs?: string[];
  },
  // Undefined = repo has no stored settings row -> "never configured" ->
  // GitHub default-on eligibility path in resolveRepoSelectedSlugs. A
  // defined array = a SAVED, explicit repo-level selection (workspace
  // settings), which resolveRepoSelectedSlugs must report as explicit.
  repoSelectedToolkitSlugs?: string[],
) {
  mock.module("@/lib/db/composio", () => ({
    getRepositoryComposioSettings: () =>
      Promise.resolve(
        repoSelectedToolkitSlugs === undefined
          ? undefined
          : { id: "repo-settings-1119" },
      ),
    getRepositoryComposioSettingsValues: (raw: { id: string } | undefined) =>
      raw ? { selectedToolkitSlugs: repoSelectedToolkitSlugs ?? null } : null,
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
        id: "chat-1119",
        sessionId: "session-1119",
        composioSelection: chatSelection,
      }),
    // repoOwner/repoName present so resolveRepoSelectedSlugs runs.
    getSessionById: () =>
      Promise.resolve({ repoOwner: "dennisonbertram", repoName: "pi-google" }),
  }));
}

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true }),
}));

// One connected, ACTIVE GitHub account -> githubConnected = true.
mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    create: () =>
      Promise.resolve({
        sessionId: "composio-sess-1119",
        tools: () => Promise.resolve(fakeTools),
      }),
    use: () =>
      Promise.resolve({
        tools: () => Promise.resolve(fakeTools),
      }),
    connectedAccounts: {
      list: () =>
        Promise.resolve({
          items: [
            { id: "acct-gh-1", toolkit: { slug: "github" }, status: "ACTIVE" },
          ],
        }),
    },
  }),
}));

describe("#1119: implicit repo-default selection in managed runtime mode", () => {
  test("case 1: managed runtime + nothing explicit + GitHub connected -> off, no throw", async () => {
    mockDb({ mainProfileId: null });
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1119",
      chatId: "chat-1119",
      runtimeMode: "managed_runtime",
    });

    expect(result.status).toBe("off");
  });

  test("case 2: managed runtime + explicit chat mainProfileId -> still throws", async () => {
    mockDb({ mainProfileId: "profile-explicit" });
    const { resolveComposioToolsForChat, ComposioSetupError } =
      await import("./session");

    await expect(
      resolveComposioToolsForChat({
        userId: "user-1119",
        chatId: "chat-1119",
        runtimeMode: "managed_runtime",
      }),
    ).rejects.toBeInstanceOf(ComposioSetupError);
  });

  test("case 3: managed runtime + explicit chat directToolkitSlugs -> still throws", async () => {
    mockDb({ mainProfileId: null, directToolkitSlugs: ["linear"] });
    const { resolveComposioToolsForChat, ComposioSetupError } =
      await import("./session");

    await expect(
      resolveComposioToolsForChat({
        userId: "user-1119",
        chatId: "chat-1119",
        runtimeMode: "managed_runtime",
      }),
    ).rejects.toBeInstanceOf(ComposioSetupError);
  });

  test("case 4: classic mode + nothing explicit + GitHub connected -> still gets github tools", async () => {
    mockDb({ mainProfileId: null });
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1119",
      chatId: "chat-1119",
      runtimeMode: "classic",
    });

    expect(result.status).toBe("ready");
  });

  test("case 5: explicit-off sentinel still short-circuits in managed runtime mode", async () => {
    mockDb({ mainProfileId: null, directToolkitSlugs: [] });
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1119",
      chatId: "chat-1119",
      runtimeMode: "managed_runtime",
    });

    expect(result.status).toBe("off");
  });

  test("case 6 (P2 review follow-up): managed runtime + SAVED repo-level selectedToolkitSlugs -> still throws", async () => {
    // Repo has a saved, explicit selection in workspace settings (e.g.
    // Slack enabled) — nothing at the chat or agent-row tier. This must be
    // treated like an explicit selection, not the implicit GitHub
    // default-on, and must throw in managed runtime mode.
    mockDb({ mainProfileId: null }, ["slack"]);
    const { resolveComposioToolsForChat, ComposioSetupError } =
      await import("./session");

    await expect(
      resolveComposioToolsForChat({
        userId: "user-1119",
        chatId: "chat-1119",
        runtimeMode: "managed_runtime",
      }),
    ).rejects.toBeInstanceOf(ComposioSetupError);
  });
});
