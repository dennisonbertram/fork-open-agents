import { describe, expect, test } from "bun:test";

// These tests will fail until direct-list-config.ts is implemented.
const { buildComposioSessionConfigFromDirectList, hashDirectConfig } =
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

describe("hashDirectConfig — connected-account state sensitivity (issue #797 / G8)", () => {
  test("BT-DLC-001: same slugs, different connected-account membership -> different hash", () => {
    const h1 = hashDirectConfig(["github", "linear"], {
      github: ["acct-gh-1"],
      linear: ["acct-ln-1"],
    });
    const h2 = hashDirectConfig(["github", "linear"], {
      github: ["acct-gh-2"],
      linear: ["acct-ln-1"],
    });

    expect(h1).not.toBe(h2);
  });

  test("BT-DLC-002: reconnecting (new account id) changes the hash so a stale session is not reused", () => {
    const beforeReconnect = hashDirectConfig(["slack"], {
      slack: ["acct-slack-old"],
    });
    const afterReconnect = hashDirectConfig(["slack"], {
      slack: ["acct-slack-new"],
    });

    expect(beforeReconnect).not.toBe(afterReconnect);
  });

  test("BT-DLC-003: disconnecting (account removed) changes the hash", () => {
    const connected = hashDirectConfig(["slack"], {
      slack: ["acct-slack-1"],
    });
    const disconnected = hashDirectConfig(["slack"], {});

    expect(connected).not.toBe(disconnected);
  });

  test("BT-DLC-004: identical slugs and identical connected-account state -> stable hash, no spurious invalidation", () => {
    const first = hashDirectConfig(["github", "linear"], {
      github: ["acct-gh-1"],
      linear: ["acct-ln-1", "acct-ln-2"],
    });
    const second = hashDirectConfig(["linear", "github"], {
      linear: ["acct-ln-2", "acct-ln-1"],
      github: ["acct-gh-1"],
    });

    expect(first).toBe(second);
  });

  test("BT-DLC-005: connected-account ids for toolkits NOT in the slug list do not affect the hash", () => {
    const withoutExtra = hashDirectConfig(["github"], {
      github: ["acct-gh-1"],
    });
    const withExtraUnrelatedAccount = hashDirectConfig(["github"], {
      github: ["acct-gh-1"],
      gmail: ["acct-gmail-should-not-affect-hash"],
    });

    expect(withoutExtra).toBe(withExtraUnrelatedAccount);
  });
});
