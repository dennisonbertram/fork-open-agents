/**
 * Tests for pure helpers extracted from session-starter.tsx.
 *
 * BT-001: getSessionFooter — empty mode shows reassurance (no "sandbox" claim)
 * BT-002: getSessionFooter — repo mode shows sandbox name
 * BT-003: isSubmitBlocked — requiresVercelChoice alone does NOT block submit
 * BT-004: isSubmitBlocked — actual blocking conditions still block submit
 * BT-005: getButtonLabel — empty mode reads "Start chat", repo mode reads "Start with owner/repo"
 */

import { describe, expect, test } from "bun:test";
import {
  getButtonLabel,
  getSessionFooter,
  isSubmitBlocked,
} from "./session-starter-helpers";

// ---------------------------------------------------------------------------
// BT-001 / BT-002: footer mode helper
// ---------------------------------------------------------------------------
describe("getSessionFooter", () => {
  test("BT-001: empty mode does not claim 'Using ... sandbox' (no false sandbox claim)", () => {
    const result = getSessionFooter("empty", "Vercel");
    // Must NOT claim a sandbox is actively being used — the word "using" should
    // not appear as that would mislead users in sandbox-free chat mode.
    expect(result.toLowerCase()).not.toContain("using");
    // Must NOT contain the sandbox name as though it is provisioned.
    expect(result).not.toContain("Vercel");
  });

  test("BT-001: empty mode result contains 'instant' or 'no sandbox' messaging", () => {
    const result = getSessionFooter("empty", "Vercel");
    // Must communicate that no sandbox is provisioned
    const lower = result.toLowerCase();
    const hasReassurance =
      lower.includes("instant") ||
      lower.includes("no sandbox") ||
      lower.includes("without a sandbox") ||
      lower.includes("sandbox-free");
    expect(hasReassurance).toBe(true);
  });

  test("BT-002: repo mode returns a string containing the sandbox name", () => {
    const result = getSessionFooter("repo", "Vercel");
    expect(result).toContain("Vercel");
  });

  test("BT-002: repo mode result contains 'sandbox'", () => {
    const result = getSessionFooter("repo", "Vercel");
    expect(result.toLowerCase()).toContain("sandbox");
  });

  test("BT-002: repo mode result contains 'Using'", () => {
    const result = getSessionFooter("repo", "Vercel");
    expect(result).toContain("Using");
  });
});

// ---------------------------------------------------------------------------
// BT-003 / BT-004: isSubmitBlocked helper
// ---------------------------------------------------------------------------
describe("isSubmitBlocked", () => {
  const baseParams = {
    controlsDisabled: false,
    mode: "repo" as const,
    isRepoModeDisabled: false,
    githubConnectionLoading: false,
    reconnectRequired: false,
    isRepoSelectionComplete: true,
    isVercelLookupPending: false,
    requiresVercelChoice: true, // <-- unresolved Vercel choice
  };

  test("BT-003: requiresVercelChoice=true alone does NOT block submit", () => {
    // The old code blocked here. New behavior: don't block.
    const result = isSubmitBlocked(baseParams);
    expect(result).toBe(false);
  });

  test("BT-003: requiresVercelChoice=false also does not block submit in clean state", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      requiresVercelChoice: false,
    });
    expect(result).toBe(false);
  });

  test("BT-004: controlsDisabled blocks submit", () => {
    const result = isSubmitBlocked({ ...baseParams, controlsDisabled: true });
    expect(result).toBe(true);
  });

  test("BT-004: isRepoModeDisabled + repo mode blocks submit", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      mode: "repo",
      isRepoModeDisabled: true,
    });
    expect(result).toBe(true);
  });

  test("BT-004: githubConnectionLoading in repo mode blocks submit", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      githubConnectionLoading: true,
    });
    expect(result).toBe(true);
  });

  test("BT-004: reconnectRequired in repo mode blocks submit", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      reconnectRequired: true,
    });
    expect(result).toBe(true);
  });

  test("BT-004: incomplete repo selection blocks submit", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      isRepoSelectionComplete: false,
    });
    expect(result).toBe(true);
  });

  test("BT-004: pending Vercel lookup blocks submit", () => {
    const result = isSubmitBlocked({
      ...baseParams,
      isVercelLookupPending: true,
    });
    expect(result).toBe(true);
  });

  test("BT-004: empty mode with no blocking conditions is not blocked", () => {
    const result = isSubmitBlocked({
      controlsDisabled: false,
      mode: "empty",
      isRepoModeDisabled: false,
      githubConnectionLoading: false,
      reconnectRequired: false,
      isRepoSelectionComplete: true,
      isVercelLookupPending: false,
      requiresVercelChoice: false,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BT-005: getButtonLabel
// ---------------------------------------------------------------------------
describe("getButtonLabel", () => {
  test("BT-005: empty mode returns 'Start chat'", () => {
    expect(getButtonLabel("empty", "", "")).toBe("Start chat");
  });

  test("BT-005: repo mode with no repo selected returns 'Start chat'", () => {
    expect(getButtonLabel("repo", "", "")).toBe("Start chat");
  });

  test("BT-005: repo mode with owner+repo returns 'Start with owner/repo'", () => {
    expect(getButtonLabel("repo", "acme", "webapp")).toBe(
      "Start with acme/webapp",
    );
  });
});
