/**
 * Regression coverage for #799 (epic #796, T3): predictable repo-policy
 * composition across chat, background agents, and loops.
 *
 * These tests pin two independent things that must NOT regress:
 *
 * 1. The full chat precedence chain (resolveComposioSlugsForChatMain),
 *    including the new explicit-off short-circuit, still resolves each
 *    tier correctly and in the documented order:
 *      chat direct slugs > chat profile > agent-row slugs > agent-row
 *      profile > repo selected slugs > off
 *
 * 2. The shared repo-policy resolver's (applyRepoToolkitPolicy) allowlist/
 *    denylist composition rules:
 *      - allowlist non-null excludes non-members
 *      - denylist excludes members
 *      - both set: denylist wins on overlap
 *      - absent settings row: unrestricted (every requested slug passes)
 *
 * If a future change reverts the #799 fix and reintroduces per-surface
 * divergence, or breaks any single precedence tier, these tests fail.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveComposioSlugsForChatMain } from "./resolve-chat-with-agent-row";

// ---------------------------------------------------------------------------
// Part 1: full chat precedence chain, tier by tier (pure function, no I/O)
// ---------------------------------------------------------------------------

describe("REGRESSION: full chat precedence chain resolves each tier correctly", () => {
  test("REG-PREC-001: tier 0 — explicit off ([]) wins over EVERY lower tier simultaneously present", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: [],
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile",
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: [], profileId: null });
  });

  test("REG-PREC-002: tier 1 — chat direct slugs win over chat profile, agent row, and repo tiers", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: ["notion"],
      chatMainProfileId: "chat-profile",
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile",
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: ["notion"], profileId: null });
  });

  test("REG-PREC-003: tier 2 — chat profile wins over agent row and repo tiers (no chat direct slugs)", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: "chat-profile",
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile",
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: null, profileId: "chat-profile" });
  });

  test("REG-PREC-004: tier 3 — agent-row slugs win over agent-row profile and repo tiers", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile",
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: ["github"], profileId: null });
  });

  test("REG-PREC-005: tier 4 — agent-row profile wins over the repo tier", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: "agent-profile",
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: null, profileId: "agent-profile" });
  });

  test("REG-PREC-006: tier 5 — repo selected slugs used only when every higher tier is absent", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
      repoSelectedSlugs: ["slack"],
    });
    expect(result).toEqual({ directSlugs: ["slack"], profileId: null });
  });

  test("REG-PREC-007: tier 6 — off when nothing at any tier is set", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
      repoSelectedSlugs: null,
    });
    expect(result).toEqual({ directSlugs: null, profileId: null });
  });
});

// ---------------------------------------------------------------------------
// Part 2: shared repo-policy resolver composition rules (mocked DB boundary)
// ---------------------------------------------------------------------------

mock.module("server-only", () => ({}));

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: () => Promise.resolve({} as unknown),
  getRepositoryComposioSettingsValues: () => repoSettingsValues,
}));

const repoPolicyModulePromise = import("./repo-policy");

beforeEach(() => {
  repoSettingsValues = null;
});

describe("REGRESSION: repo-policy allowlist/denylist composition rules", () => {
  test("REG-COMP-001: non-null allowlist excludes every non-member, regardless of order", () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["slack", "notion"],
      blockedToolkitSlugs: [],
    };
    return repoPolicyModulePromise.then(async ({ applyRepoToolkitPolicy }) => {
      const result = await applyRepoToolkitPolicy({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "widgets",
        requestedSlugs: ["gmail", "slack", "linear", "notion"],
      });
      expect(result.allowed.sort()).toEqual(["notion", "slack"]);
      expect(result.blocked).toEqual(
        expect.arrayContaining([
          { slug: "gmail", reason: "not_in_repo_allowlist" },
          { slug: "linear", reason: "not_in_repo_allowlist" },
        ]),
      );
    });
  });

  test("REG-COMP-002: denylist excludes every member, case-insensitively", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["Gmail", "SLACK"],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;
    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["gmail", "slack", "notion"],
    });
    expect(result.allowed).toEqual(["notion"]);
    expect(result.blocked).toEqual(
      expect.arrayContaining([
        { slug: "gmail", reason: "repo_policy_blocked" },
        { slug: "slack", reason: "repo_policy_blocked" },
      ]),
    );
  });

  test("REG-COMP-003: both set together — denylist wins on overlap with the allowlist", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["gmail", "slack"],
      blockedToolkitSlugs: ["gmail"],
    };
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;
    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["gmail", "slack"],
    });
    expect(result.allowed).toEqual(["slack"]);
    // gmail is in the allowlist but ALSO in the denylist — the denylist
    // reason must win, not "not_in_repo_allowlist" (it IS in the allowlist).
    expect(result.blocked).toEqual([
      { slug: "gmail", reason: "repo_policy_blocked" },
    ]);
  });

  test("REG-COMP-004: absent settings row is fully unrestricted — every requested slug passes", async () => {
    repoSettingsValues = null;
    const { applyRepoToolkitPolicy } = await repoPolicyModulePromise;
    const result = await applyRepoToolkitPolicy({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requestedSlugs: ["gmail", "slack", "notion", "linear"],
    });
    expect(result.allowed).toEqual(["gmail", "slack", "notion", "linear"]);
    expect(result.blocked).toEqual([]);
  });
});
