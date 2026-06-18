/**
 * Regression test: pins the OBSERVABLE behavior of resolveComposioToolsForChat
 * for the direct-list path BEFORE and AFTER the Phase 2 extraction.
 *
 * These tests characterize the existing behavior exactly so the refactor is
 * provably non-breaking. They should pass pre-refactor AND post-refactor.
 *
 * REGRESSION-001: direct-list happy path → status ready, reusedSession=false,
 *   correct composioSessionId, tools object returned.
 * REGRESSION-002: cache hit → reusedSession=true, touch is called, upsert is NOT.
 * REGRESSION-003: non-main agentKey → direct-list is skipped → status off.
 * REGRESSION-004: managed_runtime mode with directSlugs → resolves to ready
 *   (the runtime-mode guard is removed; runtime-mode tool gating is now enforced
 *   downstream in packages/agent/open-agent.ts).
 */

import { describe, expect, mock, test } from "bun:test";
import { normalizeChatComposioSelection } from "./types";

mock.module("server-only", () => ({}));

// ── Shared fake composio client ──────────────────────────────────────────────
const fakeTools = { github_get_repo: { description: "stub" } };
const fakeComposioSessionId = "regression-composio-sess";

// ── Module mocks (registered before any dynamic import of session.ts) ────────
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
      id: "chat-reg-1",
      sessionId: "session-reg-1",
      composioSelection: {
        mainProfileId: null,
        directToolkitSlugs: ["github", "linear"],
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
      list: () =>
        Promise.resolve({
          items: [
            { id: "acct-gh-1", toolkit: { slug: "github" }, status: "ACTIVE" },
          ],
        }),
    },
  }),
}));

describe("resolveComposioToolsForChat — regression (direct-list branch)", () => {
  test("REGRESSION-001: happy path returns ready with correct shape", async () => {
    const { resolveComposioToolsForChat } = await import("./session");

    const result = await resolveComposioToolsForChat({
      userId: "user-reg-1",
      chatId: "chat-reg-1",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.reusedSession).toBe(false);
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
      expect(typeof result.tools).toBe("object");
      expect(result.profile).toBeNull();
      // configHash must be a non-empty hex string
      expect(result.configHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("REGRESSION-002: cache hit path returns reusedSession=true and calls touch", async () => {
    let touchCalled = false;

    mock.module("@/lib/db/composio", () => ({
      getRepositoryComposioSettings: () => Promise.resolve(undefined),
      getRepositoryComposioSettingsValues: () => null,
      getChatComposioSelection: (v: unknown) =>
        normalizeChatComposioSelection(v),
      getComposioAgentSession: () =>
        Promise.resolve({
          id: "row-hit",
          composioSessionId: fakeComposioSessionId,
        }),
      upsertComposioAgentSession: () => {
        throw new Error("upsert must not be called on a cache hit");
      },
      touchComposioAgentSession: (_id: string) => {
        touchCalled = true;
        return Promise.resolve();
      },
      getComposioToolProfile: () => Promise.resolve(null),
      isComposioProfileAllowedForRepository: () =>
        Promise.resolve({ allowed: true }),
    }));

    const { resolveComposioToolsForChat: resolveHit } =
      await import("./session");

    const result = await resolveHit({
      userId: "user-reg-2",
      chatId: "chat-reg-1",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.reusedSession).toBe(true);
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
    }
    expect(touchCalled).toBe(true);
  });

  test("REGRESSION-003: non-main agentKey skips direct-list and returns off", async () => {
    // Chat has directToolkitSlugs but agentKey=executor → no profile → off
    mock.module("@/lib/db/composio", () => ({
      getRepositoryComposioSettings: () => Promise.resolve(undefined),
      getRepositoryComposioSettingsValues: () => null,
      getChatComposioSelection: (v: unknown) =>
        normalizeChatComposioSelection(v),
      getComposioAgentSession: () => Promise.resolve(null),
      upsertComposioAgentSession: () => Promise.resolve({ id: "row-1" }),
      touchComposioAgentSession: () => Promise.resolve(),
      getComposioToolProfile: () => Promise.resolve(null),
      isComposioProfileAllowedForRepository: () =>
        Promise.resolve({ allowed: true }),
    }));

    const { resolveComposioToolsForChat: resolveExecutor } =
      await import("./session");

    const result = await resolveExecutor({
      userId: "user-reg-3",
      chatId: "chat-reg-1",
      agentKey: "executor",
    });

    // executor doesn't participate in direct-list; no profile set → off
    expect(result.status).toBe("off");
  });

  test("REGRESSION-004: managed_runtime with directSlugs resolves tools (no longer blocked)", async () => {
    mock.module("@/lib/db/composio", () => ({
      getRepositoryComposioSettings: () => Promise.resolve(undefined),
      getRepositoryComposioSettingsValues: () => null,
      getChatComposioSelection: (v: unknown) =>
        normalizeChatComposioSelection(v),
      getComposioAgentSession: () => Promise.resolve(null),
      upsertComposioAgentSession: () => Promise.resolve({ id: "row-1" }),
      touchComposioAgentSession: () => Promise.resolve(),
      getComposioToolProfile: () => Promise.resolve(null),
      isComposioProfileAllowedForRepository: () =>
        Promise.resolve({ allowed: true }),
    }));

    const { resolveComposioToolsForChat: resolveMR } =
      await import("./session");

    // managed_runtime now allows Composio tools — the runtime-mode guard is removed
    const result = await resolveMR({
      userId: "user-reg-4",
      chatId: "chat-reg-1",
      runtimeMode: "managed_runtime",
    });
    // directSlugs resolves → ready (tools fetched from Composio)
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      // tools must actually be resolved — mirror REGRESSION-001's shape checks
      expect(typeof result.tools).toBe("object");
      expect(result.tools).not.toBeNull();
      expect(Object.keys(result.tools).length).toBeGreaterThan(0);
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
    }
  });
});
