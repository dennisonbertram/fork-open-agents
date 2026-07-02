/**
 * Unit tests for resolveComposioToolsForToolkitList.
 *
 * RED phase: these tests will FAIL until resolve-toolkit-list.ts is created.
 *
 * BT-RTL-001: cache hit — when getCachedSession returns a session, composio.use
 *   is called, tools are returned, touchSession is called, and reusedSession=true.
 * BT-RTL-002: cache miss — when getCachedSession returns null, composio.create
 *   is called, upsertSession is called, and reusedSession=false.
 * BT-RTL-003: empty slugs — empty array returns { status: "off" }.
 * BT-RTL-004: configHash stability — same slugs always produce the same hash,
 *   different slug sets produce different hashes.
 * BT-RTL-007 (issue #797 / finding G9): a toolkit slug that Composio's toolkit
 *   metadata marks as not requiring auth is excluded from disconnectedToolkits
 *   even when it has zero connected accounts.
 */

import type { ToolSet } from "ai";
import { describe, expect, mock, test } from "bun:test";

// Must stub server-only before importing the module under test.
mock.module("server-only", () => ({}));

// Cast to ToolSet so the fake passes typecheck without importing the full SDK shape.
const fakeTools = {
  github_get_repo: { description: "get a repo" },
} as unknown as ToolSet;
const fakeComposioSessionId = "composio-test-session-id";

const fakeComposio = {
  create: (_userId: string, _config: never) =>
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
  // No toolkit in this fixture requires no-auth awareness by default; tests
  // that need it override this with their own fakeComposio-shaped object.
  toolkits: {
    get: (_slug: string) => Promise.resolve({ noAuth: false }),
  },
};

const userId = "user-rtl-1";
const baseSlugSet = ["github", "linear"];

describe("resolveComposioToolsForToolkitList", () => {
  test("BT-RTL-001: cache hit — reuses existing session and touches it", async () => {
    let touchCalled = false;
    let upsertCalled = false;

    const cachedRow = { id: "row-1", composioSessionId: fakeComposioSessionId };

    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const result = await resolveComposioToolsForToolkitList({
      userId,
      slugs: baseSlugSet,
      composio: fakeComposio as never,
      connectedAccountIdsByToolkit: { github: ["acct-gh-1"] },
      getCachedSession: () => Promise.resolve(cachedRow),
      upsertSession: (_data: unknown) => {
        upsertCalled = true;
        return Promise.resolve({ id: "row-1" });
      },
      touchSession: (_id: string) => {
        touchCalled = true;
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.reusedSession).toBe(true);
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
      expect(result.tools).toEqual(fakeTools);
    }
    expect(touchCalled).toBe(true);
    expect(upsertCalled).toBe(false);
  });

  test("BT-RTL-002: cache miss — creates new session and upserts it", async () => {
    let upsertData: unknown = null;
    let touchCalled = false;

    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const result = await resolveComposioToolsForToolkitList({
      userId,
      slugs: baseSlugSet,
      composio: fakeComposio as never,
      connectedAccountIdsByToolkit: { github: ["acct-gh-1"] },
      getCachedSession: () => Promise.resolve(null),
      upsertSession: (data: unknown) => {
        upsertData = data;
        return Promise.resolve({ id: "row-new" });
      },
      touchSession: (_id: string) => {
        touchCalled = true;
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.reusedSession).toBe(false);
      expect(result.composioSessionId).toBe(fakeComposioSessionId);
      expect(result.tools).toEqual(fakeTools);
    }
    expect(touchCalled).toBe(false);
    expect(upsertData).not.toBeNull();
    // The upsert must carry the composio session id
    expect((upsertData as Record<string, unknown>).composioSessionId).toBe(
      fakeComposioSessionId,
    );
  });

  test("BT-RTL-003: empty slugs — returns status off immediately", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const result = await resolveComposioToolsForToolkitList({
      userId,
      slugs: [],
      composio: fakeComposio as never,
      connectedAccountIdsByToolkit: {},
      getCachedSession: () => {
        throw new Error("should not be called");
      },
      upsertSession: () => {
        throw new Error("should not be called");
      },
      touchSession: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.status).toBe("off");
  });

  test("BT-RTL-004: configHash is stable and order-independent", async () => {
    const { resolveComposioToolsForToolkitList: resolve } =
      await import("./resolve-toolkit-list");

    // Capture the configHash by intercepting getCachedSession (receives configHash
    // via the injected call); easier to import hashDirectConfig directly
    const { hashDirectConfig } = await import("./direct-list-config");

    const h1 = hashDirectConfig(["github", "linear"]);
    const h2 = hashDirectConfig(["linear", "github"]);
    const h3 = hashDirectConfig(["github"]);

    // Same set in different order → same hash
    expect(h1).toBe(h2);
    // Different set → different hash
    expect(h1).not.toBe(h3);

    // Verify resolve passes the same hash to getCachedSession
    let capturedHash: string | undefined;
    await resolve({
      userId,
      slugs: ["github", "linear"],
      composio: fakeComposio as never,
      connectedAccountIdsByToolkit: {},
      getCachedSession: (hash: string) => {
        capturedHash = hash;
        return Promise.resolve(null);
      },
      upsertSession: () => Promise.resolve({ id: "x" }),
      touchSession: () => Promise.resolve(),
    });

    expect(capturedHash).toBe(h1);
  });

  test("BT-RTL-005: reports selected toolkits with no ACTIVE account as disconnected", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const result = await resolveComposioToolsForToolkitList({
      userId,
      slugs: ["github", "linear"],
      composio: fakeComposio as never,
      // github connected, linear missing → linear is disconnected
      connectedAccountIdsByToolkit: { github: ["acct-gh-1"] },
      getCachedSession: () => Promise.resolve(null),
      upsertSession: () => Promise.resolve({ id: "row-new" }),
      touchSession: () => Promise.resolve(),
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.disconnectedToolkits).toEqual(["linear"]);
    }
  });

  test("BT-RTL-006: all toolkits connected → empty disconnected list (cache hit too)", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const result = await resolveComposioToolsForToolkitList({
      userId,
      slugs: ["github", "linear"],
      composio: fakeComposio as never,
      connectedAccountIdsByToolkit: {
        github: ["acct-gh-1"],
        linear: ["acct-ln-1"],
      },
      getCachedSession: () =>
        Promise.resolve({ id: "row-1", composioSessionId: "sid" }),
      upsertSession: () => Promise.resolve({ id: "row-1" }),
      touchSession: () => Promise.resolve(),
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.disconnectedToolkits).toEqual([]);
    }
  });

  test("BT-RTL-007: no-auth toolkit is excluded from disconnectedToolkits even with zero connected accounts", async () => {
    const { resolveComposioToolsForToolkitList } =
      await import("./resolve-toolkit-list");

    const noAuthAwareComposio = {
      ...fakeComposio,
      toolkits: {
        get: (slug: string) =>
          Promise.resolve({ noAuth: slug === "weather" }),
      },
    };

    const result = await resolveComposioToolsForToolkitList({
      userId,
      // "weather" is a no-auth toolkit with no connected account; "linear"
      // requires auth and also has no connected account.
      slugs: ["weather", "linear"],
      composio: noAuthAwareComposio as never,
      connectedAccountIdsByToolkit: {},
      getCachedSession: () => Promise.resolve(null),
      upsertSession: () => Promise.resolve({ id: "row-new" }),
      touchSession: () => Promise.resolve(),
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      // "weather" must NOT be reported as disconnected (no-auth toolkit);
      // "linear" must still be reported (requires auth, not connected).
      expect(result.disconnectedToolkits).toEqual(["linear"]);
    }
  });
});
