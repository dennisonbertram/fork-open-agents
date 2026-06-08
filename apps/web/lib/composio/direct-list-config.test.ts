import { describe, expect, test } from "bun:test";

// These tests will fail until direct-list-config.ts is implemented.
const { buildComposioSessionConfigFromDirectList } =
  await import("./direct-list-config");

describe("buildComposioSessionConfigFromDirectList", () => {
  test("BT-S1-001: builds a session config from slugs alone (no connected accounts)", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github", "linear"],
      connectedAccountIdsByToolkit: {},
    });

    expect(config).toEqual({
      toolkits: ["github", "linear"],
      manageConnections: false,
      workbench: { enable: false },
    });
    // connectedAccounts key must NOT be present when there are no accounts
    expect("connectedAccounts" in config).toBe(false);
  });

  test("BT-S1-002: includes connectedAccounts only for selected toolkits", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github", "linear"],
      connectedAccountIdsByToolkit: {
        github: ["acct-gh-1", "acct-gh-2"],
        linear: [],
        gmail: ["acct-gmail-1"], // not selected — must be excluded
      },
    });

    // only github has accounts, linear has empty array so excluded
    expect(config).toEqual({
      toolkits: ["github", "linear"],
      connectedAccounts: {
        github: ["acct-gh-1", "acct-gh-2"],
      },
      manageConnections: false,
      workbench: { enable: false },
    });
    // gmail must NOT appear — it is not in the toolkit list
    expect(
      (config.connectedAccounts as Record<string, unknown>)?.gmail,
    ).toBeUndefined();
  });

  test("BT-S1-003: normalizes slugs (trims whitespace, lowercases, deduplicates)", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: [" GitHub ", "github", "Linear "],
      connectedAccountIdsByToolkit: {},
    });

    expect(config.toolkits).toEqual(["github", "linear"]);
  });

  test("BT-S1-004: throws when the slug list is empty after normalization", () => {
    expect(() =>
      buildComposioSessionConfigFromDirectList({
        toolkitSlugs: [],
        connectedAccountIdsByToolkit: {},
      }),
    ).toThrow();
  });

  test("BT-S1-005: throws when slugs contain only invalid strings", () => {
    expect(() =>
      buildComposioSessionConfigFromDirectList({
        toolkitSlugs: ["bad slug!", "   "],
        connectedAccountIdsByToolkit: {},
      }),
    ).toThrow();
  });

  test("BT-S1-006: sets manageConnections:false and workbench.enable:false always", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["slack"],
      connectedAccountIdsByToolkit: { slack: ["acct-1"] },
    });

    expect(config.manageConnections).toBe(false);
    expect(config.workbench).toEqual({ enable: false });
  });
});
