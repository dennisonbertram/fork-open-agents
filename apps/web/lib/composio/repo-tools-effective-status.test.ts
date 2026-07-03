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
 *
 * Codex P2-2 (PR #848): an EXPIRED connected account must never be reported
 * as "allowed"/"selected"/"default_on" — those statuses claim the tool
 * actually works right now, which is false for an expired connection.
 * BT-ES-008: a slug that survives policy (allowed) with connection state
 *   "expired" reports the distinct "expired" status, not allowed/default_on.
 * BT-ES-009: an "other" (INITIATED/FAILED) connection state is treated the
 *   same as not_connected — never silently claimed as usable (mirrors the
 *   existing composio-toolkit-picker.tsx precedent for "other").
 * BT-ES-010: blocked still wins over expired (policy checked first).
 *
 * Codex P2-3 (PR #848): a no-auth toolkit (works without a connected
 * account, e.g. a public API toolkit) must never render "not_connected"
 * merely because it has no account row — the resolver's G9 semantics say
 * no-auth toolkits are usable without a connection.
 * BT-ES-011: a no-auth toolkit with no connection-state entry (survives
 *   policy) reports default_on/selected/allowed per the normal allowlist
 *   rules, not not_connected.
 * BT-ES-012: a no-auth toolkit is still reported "blocked" if repo policy
 *   blocks it — noAuth does not bypass policy, only the connection check.
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

  // ---------------------------------------------------------------------
  // Codex P2-2 (PR #848): expired/other connection honesty
  // ---------------------------------------------------------------------

  test("BT-ES-008: allowed slug with connection state 'expired' reports 'expired', not allowed/default_on", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: null,
        policyResult: { allowed: ["github", "gmail", "slack"], blocked: [] },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "expired"],
          ["slack", "active"],
        ]),
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("expired");
    expect(gmail?.status).not.toBe("allowed");
    expect(gmail?.status).not.toBe("default_on");
  });

  test("BT-ES-009: an 'other' (INITIATED/FAILED) connection state is treated as not_connected", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        selectedToolkitSlugs: ["slack"],
        policyResult: {
          allowed: ["slack"],
          blocked: [
            { slug: "github", reason: "not_in_repo_allowlist" },
            { slug: "gmail", reason: "not_in_repo_allowlist" },
          ],
        },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "active"],
          ["slack", "other"],
        ]),
      }),
    );

    const slack = result.find((r) => r.slug === "slack");
    expect(slack?.status).toBe("not_connected");
  });

  test("BT-ES-010: blocked wins over expired (policy checked first)", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        policyResult: {
          allowed: ["github", "slack"],
          blocked: [{ slug: "gmail", reason: "repo_policy_blocked" }],
        },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "expired"],
          ["slack", "active"],
        ]),
      }),
    );

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("blocked");
    expect(gmail?.blockReason).toBe("repo_policy_blocked");
  });

  // ---------------------------------------------------------------------
  // Codex P2-3 (PR #848): no-auth toolkit availability
  // ---------------------------------------------------------------------

  test("BT-ES-011: a no-auth toolkit with no connection-state entry is default_on, not not_connected", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        toolkitSlugs: ["github", "gmail", "slack", "publicapi"],
        selectedToolkitSlugs: null,
        policyResult: {
          allowed: ["github", "gmail", "slack", "publicapi"],
          blocked: [],
        },
        connectionStateBySlug: new Map([
          ["github", "active"],
          ["gmail", "active"],
          ["slack", "active"],
          // "publicapi" deliberately absent — no connected account at all.
        ]),
        noAuthSlugs: new Set(["publicapi"]),
      }),
    );

    const publicapi = result.find((r) => r.slug === "publicapi");
    expect(publicapi?.status).not.toBe("not_connected");
    expect(publicapi?.status).toBe("allowed");
  });

  test("BT-ES-012: a no-auth toolkit is still blocked when repo policy blocks it", () => {
    const result = deriveRepoToolkitEffectiveStatuses(
      baseInput({
        toolkitSlugs: ["github", "publicapi"],
        selectedToolkitSlugs: null,
        policyResult: {
          allowed: ["github"],
          blocked: [{ slug: "publicapi", reason: "repo_policy_blocked" }],
        },
        connectionStateBySlug: new Map([["github", "active"]]),
        noAuthSlugs: new Set(["publicapi"]),
      }),
    );

    const publicapi = result.find((r) => r.slug === "publicapi");
    expect(publicapi?.status).toBe("blocked");
    expect(publicapi?.blockReason).toBe("repo_policy_blocked");
  });
});
