/**
 * NO_AUTH toolkit parity regression test (#802, Codex P2 review on PR #849).
 *
 * Codex found a genuine drift: resolveComposioToolsForToolkitList
 * (lib/composio/resolve-toolkit-list.ts) calls composio.toolkits.get and
 * excludes toolkits whose Composio metadata marks them NO_AUTH from
 * disconnectedToolkits (finding G9 — a no-auth toolkit is never "missing a
 * connection" because it never needed one). computeAgentToolPreflight had
 * no equivalent check, so a NO_AUTH toolkit with zero connected accounts
 * predicted "not_connected" (with a Connect CTA) while the real bg-run path
 * would hand the model working tools for it.
 *
 * Unlike tool-preflight-parity-regression.test.ts, this file does NOT stub
 * resolve-toolkit-list.ts's own resolveComposioToolsForToolkitList — the
 * REAL module (including its private toolkitRequiresAuth check) runs here
 * on both the bg-run path and, transitively, whatever preflight now reuses
 * for no-auth detection. This is the direct proof that preflight's no-auth
 * handling is not a parallel reimplementation that could silently diverge
 * from resolve-toolkit-list.ts's real behavior.
 *
 * BT-802-PAR-004: a NO_AUTH toolkit with zero connected accounts —
 *   resolveComposioToolsForBgRun's real ready outcome excludes it from
 *   disconnectedToolkits, AND computeAgentToolPreflight predicts "ready"
 *   for it (not "not_connected").
 * BT-802-PAR-005: the no-auth detection reads the real API shape — the
 *   scheme identifier lives on authConfigDetails[].mode ("NO_AUTH"), name
 *   is a display label only ("No Auth") — mirroring BT-RTL-008 in
 *   resolve-toolkit-list.test.ts.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared DB / Composio mocks — identical fixtures feed both functions.
// resolve-toolkit-list.ts itself is NOT mocked in this file — it runs for
// real so its toolkitRequiresAuth check is exercised, not bypassed.
// ---------------------------------------------------------------------------

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: async () => ({}) as unknown,
  getRepositoryComposioSettingsValues: (
    _settings: unknown,
  ): RepoSettingsValues | null => repoSettingsValues,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      backgroundAgentToolSessions: {
        findFirst: async () => null,
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{ id: "row-1" }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoopToolSessions: {},
  backgroundAgentToolSessions: {},
}));

mock.module("nanoid", () => ({ nanoid: () => "test-nanoid" }));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test" }),
}));

mock.module("@/lib/composio/user-id", () => ({
  toComposioUserId: (userId: string) => `composio_${userId}`,
}));

type AuthConfigDetail = { name: string; mode: string };

const NO_AUTH_TOOLKIT_METADATA: Record<string, AuthConfigDetail[]> = {
  weather: [{ name: "No Auth", mode: "NO_AUTH" }],
  linear: [{ name: "Linear OAuth", mode: "OAUTH2" }],
};

const fakeTools = { weather_get_forecast: { description: "stub" } };

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      // Zero connected accounts at all — both "weather" (no-auth) and
      // "linear" (requires auth) start from an identical empty state.
      list: async () => ({ items: [] }),
    },
    toolkits: {
      get: async (slug: string) => ({
        authConfigDetails: NO_AUTH_TOOLKIT_METADATA[slug] ?? [
          { name: "OAuth2", mode: "OAUTH2" },
        ],
      }),
    },
    // resolveComposioToolsForToolkitList's session-create path — reached
    // only because "weather"/"linear" still resolve "ready" overall (a
    // no-auth toolkit's tools are still offered even without an account).
    create: async () => ({
      sessionId: "session-no-auth-parity",
      tools: async () => fakeTools,
    }),
    use: async () => ({ tools: async () => fakeTools }),
  }),
}));

// ---------------------------------------------------------------------------
// Import BOTH modules under test AFTER all mocks are registered. Neither
// resolve-toolkit-list.ts nor its toolkitRequiresAuth check is stubbed.
// ---------------------------------------------------------------------------
const composioToolsModulePromise = import("./composio-tools");
const toolPreflightModulePromise = import("./tool-preflight");

beforeEach(() => {
  repoSettingsValues = null;
});

describe("computeAgentToolPreflight NO_AUTH parity with the real bg-run path (#802 Codex regression)", () => {
  test("BT-802-PAR-004: a NO_AUTH toolkit with zero connected accounts is 'ready' on both paths, not 'not connected'", async () => {
    const { resolveComposioToolsForBgRun } = await composioToolsModulePromise;
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const realOutcome = await resolveComposioToolsForBgRun({
      agentId: "agent-1",
      runId: "run-1",
      userId: "user-1",
      slugs: ["weather", "linear"],
      repoOwner: "acme",
      repoName: "widgets",
    });
    const preflight = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["weather", "linear"],
    });

    expect(realOutcome.status).toBe("ready");
    expect(
      realOutcome.status === "ready" && realOutcome.disconnectedToolkits,
    ).toEqual(["linear"]);

    const weatherPrediction = preflight.toolkits.find(
      (t) => t.slug === "weather",
    );
    const linearPrediction = preflight.toolkits.find(
      (t) => t.slug === "linear",
    );
    expect(weatherPrediction?.predictedState).toBe("ready");
    expect(linearPrediction?.predictedState).toBe("not_connected");
  });

  test("BT-802-PAR-005: no-auth detection reads the real API shape — mode is the identifier, name is a display label", async () => {
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    // "weather"'s fixture metadata above deliberately puts a human display
    // label ("No Auth") on `name` alongside the real identifier on `mode`
    // ("NO_AUTH") — mirroring the real Composio API shape (Codex review on
    // PR #820, BT-RTL-008). If preflight's detection only checked `name`
    // for the literal string "NO_AUTH" it would still pass by coincidence
    // here; the companion unit test in tool-preflight.test.ts
    // (BT-802-009) additionally covers a metadata shape with no name match
    // at all to close that gap.
    const preflight = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["weather"],
    });

    expect(preflight.toolkits).toEqual([
      { slug: "weather", predictedState: "ready" },
    ]);
  });
});
