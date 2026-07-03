/**
 * Unit tests for the repo-tools effective-status derivation (#805, epic #796
 * T9 — discoverable per-repo Tools surface).
 *
 * This is the ONE place that composes applyRepoToolkitPolicy's allow/block
 * result with the #800 four-state connection-state helpers into a single
 * effective status per toolkit, for rendering on the repo Tools surface and
 * the settings/repositories page. It must never re-derive allow/block logic
 * itself — that stays the sole responsibility of applyRepoToolkitPolicy.
 *
 * BT-ES-001: a slug in blockedToolkitSlugs (repo-policy blocked reason) is
 *   reported "blocked" with rule "repo_policy_blocked", regardless of
 *   connection state.
 * BT-ES-002: a slug excluded by a non-null selectedToolkitSlugs allowlist is
 *   "blocked" with rule "not_in_repo_allowlist".
 * BT-ES-003: selectedToolkitSlugs === null (never configured) and the slug
 *   is "github" with an active connection => "default_on".
 * BT-ES-004: a slug present in a non-null selectedToolkitSlugs allowlist
 *   (and not blocked) is "selected".
 * BT-ES-005: a slug that survives policy (allowed) but has no connected
 *   account at all is "not_connected" even if selected/allowed — never a
 *   bare allow/block toggle implying it would work.
 * BT-ES-006: statuses compose — blocked-but-unconnected still reports
 *   "blocked" (policy is checked first; connection state is not required to
 *   explain a block).
 * BT-ES-007: null vs [] allowlist semantics render distinctly — an empty
 *   selectedToolkitSlugs array ([] explicit choice) does NOT behave like
 *   null (default-on); a github slug with selectedToolkitSlugs === [] is
 *   "blocked" (not_in_repo_allowlist), not "default_on".
 */
import { describe, expect, test } from "bun:test";
import {
  deriveRepoToolkitEffectiveStatuses,
  type RepoToolkitEffectiveStatusInput,
} from "./repo-tools-effective-status";

function baseInput(
  overrides: Partial<RepoToolkitEffectiveStatusInput> = {},
): RepoToolkitEffectiveStatusInput {
  return {
    toolkitSlugs: ["github", "gmail", "slack"],
    selectedToolkitSlugs: null,
    policyResult: { allowed: ["github", "gmail", "slack"], blocked: [] },
    connectionStateBySlug: new Map([
      ["github", "active"],
      ["gmail", "active"],
      ["slack", "active"],
    ]),
    ...overrides,
  };
}

describe("deriveRepoToolkitEffectiveStatuses", () => {
  test("BT-ES-001: blocked by repo policy reports blocked + repo_policy_blocked rule", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        policyResult: {
          allowed: ["github", "slack"],
          blocked: [{ slug: "gmail", reason: "repo_policy_blocked" }],
        },
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("blocked");
    expect(gmail?.blockReason).toBe("repo_policy_blocked");
  });

  test("BT-ES-002: excluded by a non-null allowlist reports blocked + not_in_repo_allowlist rule", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: ["github"],
        policyResult: {
          allowed: ["github"],
          blocked: [
            { slug: "gmail", reason: "not_in_repo_allowlist" },
            { slug: "slack", reason: "not_in_repo_allowlist" },
          ],
        },
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("blocked");
    expect(gmail?.blockReason).toBe("not_in_repo_allowlist");
  });

  test("BT-ES-003: null selectedToolkitSlugs + github connected => default_on", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({ selectedToolkitSlugs: null }),
    );

    const github = result.find((r) => r.slug === "github");
    expect(github?.status).toBe("default_on");
  });

  test("BT-ES-004: slug present in a non-null allowlist (and not blocked) is selected", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: ["github", "slack"],
        policyResult: {
          allowed: ["github", "slack"],
          blocked: [{ slug: "gmail", reason: "not_in_repo_allowlist" }],
        },
      }),
    );

    const slack = result.find((r) => r.slug === "slack");
    expect(slack?.status).toBe("selected");
  });

  test("BT-ES-005: allowed by policy but no connected account is not_connected", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: ["gmail"],
        policyResult: {
          allowed: ["gmail"],
          blocked: [
            { slug: "github", reason: "not_in_repo_allowlist" },
            { slug: "slack", reason: "not_in_repo_allowlist" },
          ],
        },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "not_connected"],
          ["slack", "active"],
        ]),
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("not_connected");
  });

  test("BT-ES-006: blocked-but-unconnected still reports blocked (policy checked first)", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        policyResult: {
          allowed: ["github", "slack"],
          blocked: [{ slug: "gmail", reason: "repo_policy_blocked" }],
        },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "not_connected"],
          ["slack", "active"],
        ]),
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("blocked");
    expect(gmail?.blockReason).toBe("repo_policy_blocked");
  });

  test("BT-ES-007: explicit empty allowlist ([]) is NOT the same as null (default_on)", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: [],
        policyResult: {
          allowed: [],
          blocked: [
            { slug: "github", reason: "not_in_repo_allowlist" },
            { slug: "gmail", reason: "not_in_repo_allowlist" },
            { slug: "slack", reason: "not_in_repo_allowlist" },
          ],
        },
      }),
    );

    const github = result.find((r) => r.slug === "github");
    expect(github?.status).toBe("blocked");
    expect(github?.blockReason).toBe("not_in_repo_allowlist");
    expect(github?.status).not.toBe("default_on");
  });

  test("every requested toolkit slug produces exactly one status entry", () => {
    const result = deriveRepoToolkitEffectiveStatuses(baseInput());
    expect(result.map((r) => r.slug).sort()).toEqual([
      "github",
      "gmail",
      "slack",
    ]);
  });
});
