/**
 * Regression tests for #1119: an IMPLICIT repo-default Composio selection
 * (GitHub default-on for an unconfigured repo, `apps/web/lib/composio/
 * session.ts` `resolveRepoSelectedSlugs`) must not hard-fail a
 * managed-runtime chat. An EXPLICIT selection (chat-level directSlugs or
 * mainProfileId) must still throw, since silently dropping tools a user
 * deliberately chose is worse than a clear error.
 *
 * Covers the five cases from #1119:
 *   1. managed runtime + nothing explicit + GitHub connected -> no Composio
 *      tools, no throw.
 *   2. managed runtime + explicit chat mainProfileId -> still throws.
 *   3. managed runtime + explicit chat directToolkitSlugs -> still throws.
 *   4. classic + nothing explicit + GitHub connected -> still gets
 *      ["github"] (default-on preserved where it works).
 *   5. the explicit-off sentinel ({directToolkitSlugs: []}) still
 *      short-circuits, even in managed runtime mode.
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

const fakeTools = { github_get_repo: {} };

function mockDb(chatSelection: {
  mainProfileId: string | null;
  // Omit the key entirely for "never set" — the real input schema is
  // .strict() with directToolkitSlugs typed array-or-undefined (not
  // array-or-null). Passing an explicit null fails schema validation and
  // silently falls back to the all-defaults selection, masking whatever
  // case is under test.
  directToolkitSlugs?: string[];
}) {
  mock.module("@/lib/db/composio", () => ({
    // Repo has no stored settings -> "never configured" -> GitHub
    // default-on eligibility path in resolveRepoSelectedSlugs.
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
});
