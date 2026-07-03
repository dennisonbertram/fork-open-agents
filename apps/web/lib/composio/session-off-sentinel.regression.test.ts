/**
 * End-to-end regression test for the chat "Off" sentinel (#799, finding G1).
 *
 * Proves the full path survives: the compact selector's exact "Off" payload
 * ({ mainProfileId: null, directToolkitSlugs: [] }) is stored via
 * getChatComposioSelection (normalizeChatComposioSelection), and
 * resolveComposioToolsForChat resolves it to { status: "off" } — WITHOUT
 * calling the Composio toolkit-list resolver at all, even though the
 * resolveAgentForRole call throws in this test sandbox (no DB) and its
 * catch-and-fallback path would otherwise have no agent-row contribution to
 * override anyway. This test's purpose is specifically the storage-layer +
 * resolver-layer interaction, not the agent-row tier (covered by
 * resolve-chat-with-agent-row.test.ts's BT-C-004 in isolation).
 *
 * If a future change reintroduces the bug (normalizeChatComposioSelection
 * or resolveComposioSlugsForChatMain treating [] the same as absent/null),
 * this test fails because the toolkit-list resolver would be invoked (or
 * the direct-slug branch entered) when it must not be.
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

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
      id: "chat-off-1",
      sessionId: "session-off-1",
      // Exact payload the compact selector's "Off" button sends
      // (composio-tool-selector-compact.tsx), stored as raw jsonb and
      // read back through getChatComposioSelection.
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: [],
      },
    }),
  getSessionById: () => Promise.resolve({ repoOwner: null, repoName: null }),
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true }),
}));

let toolkitListCalled = false;
mock.module("@/lib/composio/resolve-toolkit-list", () => ({
  resolveComposioToolsForToolkitList: () => {
    toolkitListCalled = true;
    return Promise.reject(
      new Error(
        "must not be called — the chat explicitly turned tools off ([])",
      ),
    );
  },
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      list: () => Promise.resolve({ items: [] }),
    },
  }),
}));

describe("REGRESSION: chat 'Off' sentinel resolves to status off end to end", () => {
  test("REG-OFF-E2E-001: composioSelection {mainProfileId: null, directToolkitSlugs: []} resolves to { status: 'off' }, never invoking the toolkit-list resolver", async () => {
    toolkitListCalled = false;
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-off-1",
      chatId: "chat-off-1",
    });

    expect(result.status).toBe("off");
    expect(toolkitListCalled).toBe(false);
  });
});
