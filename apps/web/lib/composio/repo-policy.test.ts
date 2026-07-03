/**
 * Unit tests for the shared repo-policy resolver (#799, epic #796 T3).
 *
 * applyRepoToolkitPolicy is the ONE place selectedToolkitSlugs (allowlist)
 * and blockedToolkitSlugs (denylist) filtering happens. It must be consumed
 * identically by chat direct-slug, chat profile, background-agent, and loop
 * resolution — see repo-policy.parity.test.ts for the cross-surface proof.
 *
 * BT-RP-001: allowlist-only — non-null selectedToolkitSlugs drops any
 *   requested slug not present in it, reason "not_in_repo_allowlist".
 * BT-RP-002: denylist-only — blockedToolkitSlugs drops matching requested
 *   slugs (case-insensitive), reason "repo_policy_blocked".
 * BT-RP-003: both set — denylist wins on overlap; anything not-allowlisted
 *   OR blocked is dropped.
 * BT-RP-004: neither set — every requested slug passes through unchanged.
 * BT-RP-005: no repo settings row at all — unrestricted (matches "neither set").
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;
let getRepositoryComposioSettingsCallCount = 0;

const getRepositoryComposioSettings = mock(async () => {
  getRepositoryComposioSettingsCallCount++;
  return {} as unknown;
});
const getRepositoryComposioSettingsValues = mock(
  (_settings: unknown): RepoSettingsValues | null => repoSettingsValues,
);

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
}));

const repoPolicyModulePromise = import("./repo-policy");

beforeEach(() => {
  repoSettingsValues = null;
  getRepositoryComposioSettingsCallCount = 0;
  getRepositoryComposioSettings.mockClear();
  getRepositoryComposioSettingsValues.mockClear();
});

describe("applyRepoToolkitPolicy — allowlist only (BT-RP-001)", () => {
  test("BT-RP-001: non-null selectedToolkitSlugs keeps only requested slugs present in it", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack"],
      blockedToolkitSlugs: [],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["slack", "gmail"],
    });

    expect(result.allowed).toEqual(["slack"]);
    expect(result.blocked).toEqual([
      { slug: "gmail", reason: "not_in_repo_allowlist" },
    ]);
  });
});

describe("applyRepoToolkitPolicy — denylist only (BT-RP-002)", () => {
  test("BT-RP-002: blockedToolkitSlugs drops matching requested slugs, case-insensitively", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["Gmail"],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["gmail", "slack"],
    });

    expect(result.allowed).toEqual(["slack"]);
    expect(result.blocked).toEqual([
      { slug: "gmail", reason: "repo_policy_blocked" },
    ]);
  });
});

describe("applyRepoToolkitPolicy — both set together (BT-RP-003)", () => {
  test("BT-RP-003: denylist wins on overlap; anything not-allowlisted OR blocked is dropped", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack", "gmail"],
      blockedToolkitSlugs: ["gmail"],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["slack", "gmail", "notion"],
    });

    expect(result.allowed).toEqual(["slack"]);
    // gmail is both allowlisted AND blocked — denylist reason wins.
    // notion is not in the allowlist at all.
    expect(result.blocked).toEqual(
      expect.arrayContaining([
        { slug: "gmail", reason: "repo_policy_blocked" },
        { slug: "notion", reason: "not_in_repo_allowlist" },
      ]),
    );
    expect(result.blocked).toHaveLength(2);
  });
});

describe("applyRepoToolkitPolicy — neither set (BT-RP-004)", () => {
  test("BT-RP-004: every requested slug passes through unchanged when no policy is configured", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: [],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["slack", "gmail"],
    });

    expect(result.allowed).toEqual(["slack", "gmail"]);
    expect(result.blocked).toEqual([]);
  });
});

describe("applyRepoToolkitPolicy — no repo settings row at all (BT-RP-005)", () => {
  test("BT-RP-005: absent settings row is unrestricted, same as neither set", async () => {
    repoSettingsValues = null;
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["slack", "gmail"],
    });

    expect(result.allowed).toEqual(["slack", "gmail"]);
    expect(result.blocked).toEqual([]);
  });
});

describe("applyRepoToolkitPolicy — loads repo settings once", () => {
  test("BT-RP-006: only one getRepositoryComposioSettings call per invocation (no double SDK/db round-trip)", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail"],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["gmail", "slack"],
    });

    expect(getRepositoryComposioSettingsCallCount).toBe(1);
  });

  test("BT-RP-007: empty requestedSlugs returns empty allowed/blocked without throwing", async () => {
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;

    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: [],
    });

    expect(result.allowed).toEqual([]);
    expect(result.blocked).toEqual([]);
  });
});
