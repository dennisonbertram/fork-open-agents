/**
 * Regression tests for resolveComposioToolsForToolkitList (Phase 2).
 *
 * These tests would FAIL if the implementation in a8341b4f were reverted or broken:
 *
 * RTL-REG-001: getCachedSession is called with the exact configHash that
 *   hashDirectConfig(slugs) produces — not some other hash.
 * RTL-REG-002: upsertSession receives composioSessionId from the new session,
 *   not a placeholder or stale value.
 * RTL-REG-003: connectedAccountIdsByToolkit is forwarded into the session
 *   config (via buildComposioSessionConfigFromDirectList) — verified by the
 *   session config received by composio.create.
 * RTL-REG-004: when getCachedSession throws, the error propagates (not silently
 *   swallowed and treated as a cache miss).
 */

import type { ToolSet } from "ai";
import type { ToolRouterCreateSessionConfig } from "@composio/core";
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const fakeTools = {} as ToolSet;
const freshSessionId = "fresh-session-abc123";

function makeFakeComposio(
  captureCreate?: (cfg: ToolRouterCreateSessionConfig) => void,
) {
  return {
    create: (_userId: string, cfg: ToolRouterCreateSessionConfig) => {
      captureCreate?.(cfg);
      return Promise.resolve({
        sessionId: freshSessionId,
        tools: () => Promise.resolve(fakeTools),
      });
    },
    use: (_sessionId: string) =>
      Promise.resolve({ tools: () => Promise.resolve(fakeTools) }),
  };
}

describe("resolveComposioToolsForToolkitList — regression suite", () => {
  test("RTL-REG-001: getCachedSession receives the exact hash of the slug set", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");
    const { hashDirectConfig } = await import("./direct-list-config");

    const slugs = ["notion", "slack", "github"];
    const expectedHash = hashDirectConfig(slugs);

    let receivedHash: string | undefined;

    await resolveComposioToolsForToolkitList({
      userId: "u-reg-1",
      slugs,
      composio: makeFakeComposio() as never,
      connectedAccountIdsByToolkit: {},
      getCachedSession: (h) => {
        receivedHash = h;
        return Promise.resolve(null);
      },
      upsertSession: () => Promise.resolve({ id: "r" }),
      touchSession: () => Promise.resolve(),
    });

    expect(receivedHash).toBe(expectedHash);
  });

  test("RTL-REG-002: upsertSession receives the composioSessionId from the new session", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    let upsertedSessionId: string | undefined;

    await resolveComposioToolsForToolkitList({
      userId: "u-reg-2",
      slugs: ["github"],
      composio: makeFakeComposio() as never,
      connectedAccountIdsByToolkit: {},
      getCachedSession: () => Promise.resolve(null),
      upsertSession: ({ composioSessionId }) => {
        upsertedSessionId = composioSessionId;
        return Promise.resolve({ id: "r" });
      },
      touchSession: () => Promise.resolve(),
    });

    expect(upsertedSessionId).toBe(freshSessionId);
  });

  test("RTL-REG-003: connectedAccountIdsByToolkit is included in session config passed to composio.create", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    let capturedConfig: ToolRouterCreateSessionConfig | undefined;

    await resolveComposioToolsForToolkitList({
      userId: "u-reg-3",
      slugs: ["github"],
      composio: makeFakeComposio((cfg) => {
        capturedConfig = cfg;
      }) as never,
      connectedAccountIdsByToolkit: { github: ["acct-reg-1", "acct-reg-2"] },
      getCachedSession: () => Promise.resolve(null),
      upsertSession: () => Promise.resolve({ id: "r" }),
      touchSession: () => Promise.resolve(),
    });

    expect(capturedConfig).toBeDefined();
    // The session config must carry the connected account ids for the toolkit
    expect(
      (capturedConfig as Record<string, unknown>).connectedAccounts,
    ).toEqual({ github: ["acct-reg-1", "acct-reg-2"] });
  });

  test("RTL-REG-004: error thrown by getCachedSession propagates, is not treated as a miss", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const dbError = new Error("simulated DB failure");

    await expect(
      resolveComposioToolsForToolkitList({
        userId: "u-reg-4",
        slugs: ["github"],
        composio: makeFakeComposio() as never,
        connectedAccountIdsByToolkit: {},
        getCachedSession: () => Promise.reject(dbError),
        upsertSession: () => Promise.resolve({ id: "r" }),
        touchSession: () => Promise.resolve(),
      }),
    ).rejects.toThrow("simulated DB failure");
  });
});
