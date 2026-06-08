import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

/**
 * Tests for the direct-list branch inside resolveComposioToolsForChat.
 *
 * We mock all I/O boundaries:
 *   - getChatById       — returns a chat with directToolkitSlugs set
 *   - getComposioConfig — returns configured
 *   - getComposioClient — returns a fake composio SDK
 *   - getComposioAgentSession — returns null (no cached session)
 *   - upsertComposioAgentSession — no-op
 *   - isComposioProfileAllowedForRepository — (not called for direct-list path)
 *
 * All tests will FAIL until session.ts is updated with the direct-list branch.
 */

// Bun module mocking
const fakeTools = { github_get_repo: {} };

// We'll use mock.module to replace the server-only modules
mock.module("server-only", () => ({}));

mock.module("@/lib/db/composio", () => ({
  getChatComposioSelection: (v: unknown) => {
    // passthrough — use real normalizer so types are correct
    return normalizeChatComposioSelection(v);
  },
  getComposioAgentSession: () => Promise.resolve(null),
  upsertComposioAgentSession: (_data: unknown) =>
    Promise.resolve({ id: "sess-row-1" }),
  touchComposioAgentSession: (_id: string) => Promise.resolve(),
  getComposioToolProfile: () => Promise.resolve(null),
  isComposioProfileAllowedForRepository: () =>
    Promise.resolve({ allowed: true }),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: (_chatId: string) =>
    Promise.resolve({
      id: "chat-1",
      sessionId: "session-1",
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: ["github", "linear"],
      },
    }),
  getSessionById: (_sessionId: string) =>
    Promise.resolve({ repoOwner: null, repoName: null }),
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true }),
}));

const fakeComposioSessionId = "composio-sess-abc";
mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    create: (_userId: string, _config: unknown) =>
      Promise.resolve({
        sessionId: fakeComposioSessionId,
        tools: () => Promise.resolve(fakeTools),
      }),
    use: (_sessionId: string) =>
      Promise.resolve({
        tools: () => Promise.resolve(fakeTools),
      }),
    // connectedAccounts.list returns the connected accounts for the user
    connectedAccounts: {
      list: (_params: unknown) =>
        Promise.resolve({
          items: [
            { id: "acct-gh-1", toolkit: { slug: "github" }, status: "ACTIVE" },
          ],
        }),
    },
  }),
}));

describe("resolveComposioToolsForChat — direct-list branch", () => {
  test("BT-S4-001: chat with directToolkitSlugs resolves to ready without consulting a profile", async () => {
    // Dynamic import AFTER mocks are registered
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
      agentKey: "main",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      // tools shape is typed by ToolSet; we just verify it's a non-null object
      expect(typeof result.tools).toBe("object");
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
      expect(result.reusedSession).toBe(false);
    }
  });

  test("BT-S4-002: direct-list path uses synthetic profileId 'direct' in session cache", async () => {
    let capturedUpsertData: unknown = null;

    mock.module("@/lib/db/composio", () => ({
      getChatComposioSelection: (v: unknown) => {
        return normalizeChatComposioSelection(v);
      },
      getComposioAgentSession: () => Promise.resolve(null),
      upsertComposioAgentSession: (data: unknown) => {
        capturedUpsertData = data;
        return Promise.resolve({ id: "sess-row-2" });
      },
      touchComposioAgentSession: () => Promise.resolve(),
      getComposioToolProfile: () => Promise.resolve(null),
      isComposioProfileAllowedForRepository: () =>
        Promise.resolve({ allowed: true }),
    }));

    const { resolveComposioToolsForChat: resolve2 } = await import("./session");
    await resolve2({ userId: "user-1", chatId: "chat-1", agentKey: "main" });

    expect(capturedUpsertData).not.toBeNull();
    // profileId must be synthetic "direct" (not a DB profile UUID)
    expect((capturedUpsertData as Record<string, unknown>).profileId).toBe(
      "direct",
    );
  });
});
