/**
 * Tests for pure helpers extracted from session-starter.tsx.
 *
 * BT-001: getSessionFooter — empty mode shows reassurance (no "sandbox" claim)
 * BT-002: getSessionFooter — repo mode shows sandbox name
 * BT-003: isSubmitBlocked — requiresVercelChoice alone does NOT block submit
 * BT-004: isSubmitBlocked — actual blocking conditions still block submit
 * BT-005: getButtonLabel — empty mode reads "Start session", repo mode names the repository
 */

import { describe, expect, test } from "bun:test";
import {
  getButtonLabel,
  getEffectiveRuntimeSelection,
  getRuntimeModeLabel,
  getRuntimeSelectionForSubmit,
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

  test("BT-001: empty mode explains on-demand sandbox creation", () => {
    const result = getSessionFooter("empty", "Vercel");
    expect(result).toBe(
      "No sandbox starts immediately. One starts automatically when code execution is needed.",
    );
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
  test("BT-005: empty mode returns 'Start session'", () => {
    expect(getButtonLabel("empty", "", "")).toBe("Start session");
  });

  test("BT-005: repo mode with no repo selected returns 'Start session'", () => {
    expect(getButtonLabel("repo", "", "")).toBe("Start session");
  });

  test("BT-005: repo mode with owner+repo returns 'Start with owner/repo'", () => {
    expect(getButtonLabel("repo", "acme", "webapp")).toBe(
      "Start with acme/webapp",
    );
  });
});

// ---------------------------------------------------------------------------
// REGRESSION tests — would fail if the green changes in 023260e7 are reverted
// ---------------------------------------------------------------------------
describe("REGRESSION — footer never makes a false sandbox claim in empty mode", () => {
  test("REGRESSION-001: getSessionFooter(empty) does not contain 'Using'", () => {
    // If the old unconditional footer were restored, this would fail because
    // the old text was "Using {sandboxName} sandbox".
    const result = getSessionFooter("empty", "Vercel");
    expect(result).not.toContain("Using");
  });

  test("REGRESSION-002: getSessionFooter(empty) does not contain the sandbox name", () => {
    // Prevents restoring the old "Using Vercel sandbox" in empty mode.
    expect(getSessionFooter("empty", "Vercel")).not.toContain("Vercel");
    expect(getSessionFooter("empty", "AnotherSandbox")).not.toContain(
      "AnotherSandbox",
    );
  });

  test("REGRESSION-003: getSessionFooter(repo) still contains 'Using' and the sandbox name", () => {
    // Repo mode must still communicate which sandbox is active.
    const result = getSessionFooter("repo", "Vercel");
    expect(result).toContain("Using");
    expect(result).toContain("Vercel");
  });
});

describe("REGRESSION — Vercel env-sync choice never hard-blocks submit", () => {
  test("REGRESSION-004: isSubmitBlocked returns false when only requiresVercelChoice=true", () => {
    // If requiresVercelChoice is re-added to the blocking conditions,
    // this test fails — catching the regression immediately.
    const result = isSubmitBlocked({
      controlsDisabled: false,
      mode: "repo",
      isRepoModeDisabled: false,
      githubConnectionLoading: false,
      reconnectRequired: false,
      isRepoSelectionComplete: true,
      isVercelLookupPending: false,
      requiresVercelChoice: true,
    });
    expect(result).toBe(false);
  });

  test("REGRESSION-005: isSubmitBlocked does not change behavior when requiresVercelChoice toggles", () => {
    // Varying requiresVercelChoice must have zero effect on the return value.
    const base = {
      controlsDisabled: false,
      mode: "repo" as const,
      isRepoModeDisabled: false,
      githubConnectionLoading: false,
      reconnectRequired: false,
      isRepoSelectionComplete: true,
      isVercelLookupPending: false,
    };
    expect(isSubmitBlocked({ ...base, requiresVercelChoice: true })).toBe(
      false,
    );
    expect(isSubmitBlocked({ ...base, requiresVercelChoice: false })).toBe(
      false,
    );
  });
});

describe("REGRESSION — button label uses Session terminology", () => {
  test("REGRESSION-006: getButtonLabel(empty) returns 'Start session'", () => {
    const label = getButtonLabel("empty", "", "");
    expect(label).toBe("Start session");
  });
});

// ---------------------------------------------------------------------------
// MR-4 (#812): New-Chat runtime picker — getRuntimeModeLabel
// ---------------------------------------------------------------------------
describe("getRuntimeModeLabel (MR-4/#812)", () => {
  test("BT-MR4-001: classic mode uses a lifecycle-neutral sandbox label", () => {
    expect(getRuntimeModeLabel("classic", "Python 3.12")).toBe(
      "Vercel sandbox (classic)",
    );
  });

  test("BT-MR4-002: managed_runtime mode names the active profile", () => {
    expect(getRuntimeModeLabel("managed_runtime", "Python 3.12")).toBe(
      "Through a verified environment (managed): Python 3.12",
    );
  });
});

// ---------------------------------------------------------------------------
// MR-4 (#812): getEffectiveRuntimeSelection — New-Chat picker prefilled from
// the Preferences default (Decision D1), user override wins, never clobbers
// an explicit user choice.
// ---------------------------------------------------------------------------
describe("getEffectiveRuntimeSelection (MR-4/#812)", () => {
  test("BT-MR4-003: with no user selection, defaults to classic (system default) when preferences default is the built-in classic profile", () => {
    const result = getEffectiveRuntimeSelection({
      userSelection: null,
      defaultRuntimeMode: "classic",
      defaultProfileId: "web-bun-agent-browser",
    });
    expect(result).toEqual({
      runtimeMode: "classic",
      managedRuntimeProfileId: undefined,
    });
  });

  test("BT-MR4-004: with no user selection and a managed default, prefills managed_runtime + the default profile id", () => {
    const result = getEffectiveRuntimeSelection({
      userSelection: null,
      defaultRuntimeMode: "managed_runtime",
      defaultProfileId: "user-profile-python312",
    });
    expect(result).toEqual({
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "user-profile-python312",
    });
  });

  test("BT-MR4-005: an explicit user selection overrides the preferences default", () => {
    const result = getEffectiveRuntimeSelection({
      userSelection: { runtimeMode: "classic" },
      defaultRuntimeMode: "managed_runtime",
      defaultProfileId: "user-profile-python312",
    });
    expect(result).toEqual({
      runtimeMode: "classic",
      managedRuntimeProfileId: undefined,
    });
  });

  test("BT-MR4-006: an explicit managed_runtime user selection carries its own profile id, not the default's", () => {
    const result = getEffectiveRuntimeSelection({
      userSelection: {
        runtimeMode: "managed_runtime",
        managedRuntimeProfileId: "user-profile-node20",
      },
      defaultRuntimeMode: "managed_runtime",
      defaultProfileId: "user-profile-python312",
    });
    expect(result).toEqual({
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "user-profile-node20",
    });
  });
});

// ---------------------------------------------------------------------------
// MR-4 (#812): "Change" no longer silently discards New-Chat dialog input.
// shouldConfirmDiscardOnChange returns true only when the user has entered
// something the navigation-away Link would silently throw away.
// ---------------------------------------------------------------------------
describe("shouldConfirmDiscardOnChange (MR-4/#812 — fixes silent discard)", () => {
  test("BT-MR4-007: no input entered — no confirm needed", async () => {
    const { shouldConfirmDiscardOnChange } =
      await import("./session-starter-helpers");
    expect(
      shouldConfirmDiscardOnChange({
        sessionTitle: "",
        mode: "empty",
        selectedOwner: "",
        selectedRepo: "",
      }),
    ).toBe(false);
  });

  test("BT-MR4-008: a typed session title requires confirmation before discarding", async () => {
    const { shouldConfirmDiscardOnChange } =
      await import("./session-starter-helpers");
    expect(
      shouldConfirmDiscardOnChange({
        sessionTitle: "My session",
        mode: "empty",
        selectedOwner: "",
        selectedRepo: "",
      }),
    ).toBe(true);
  });

  test("BT-MR4-009: a selected repo in repo mode requires confirmation before discarding", async () => {
    const { shouldConfirmDiscardOnChange } =
      await import("./session-starter-helpers");
    expect(
      shouldConfirmDiscardOnChange({
        sessionTitle: "",
        mode: "repo",
        selectedOwner: "acme",
        selectedRepo: "webapp",
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codex #834 P2: getRuntimeSelectionForSubmit — a repo is selected but
// useRepoDefaults hasn't resolved (still loading, or errored) and the user
// has NOT made an explicit picker choice yet. In that state,
// effectiveRuntimeSelection is only a not-yet-resolved "classic" fallback —
// submitting it as an explicit runtimeMode would incorrectly override the
// repo's real saved default (server precedence is body > repo defaults >
// system "classic", so an explicit fallback body value always wins even
// though it was never really chosen).
// ---------------------------------------------------------------------------
describe("getRuntimeSelectionForSubmit (Codex #834 P2)", () => {
  test("BT-P2-001: unresolved repo defaults + no explicit user choice omits runtimeMode and managedRuntimeProfileId", () => {
    const result = getRuntimeSelectionForSubmit({
      effectiveRuntimeSelection: {
        runtimeMode: "classic",
        managedRuntimeProfileId: undefined,
      },
      hasExplicitUserSelection: false,
      repoDefaultsResolved: false,
    });

    expect(result.runtimeMode).toBeUndefined();
    expect(result.managedRuntimeProfileId).toBeUndefined();
  });

  test("BT-P2-002: an explicit user choice is always sent, even while repo defaults are unresolved", () => {
    const result = getRuntimeSelectionForSubmit({
      effectiveRuntimeSelection: {
        runtimeMode: "managed_runtime",
        managedRuntimeProfileId: "user-profile-node20",
      },
      hasExplicitUserSelection: true,
      repoDefaultsResolved: false,
    });

    expect(result).toEqual({
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "user-profile-node20",
    });
  });

  test("BT-P2-003: once repo defaults resolve, the resolved selection is sent even with no explicit user choice", () => {
    const result = getRuntimeSelectionForSubmit({
      effectiveRuntimeSelection: {
        runtimeMode: "managed_runtime",
        managedRuntimeProfileId: "repo-default-profile",
      },
      hasExplicitUserSelection: false,
      repoDefaultsResolved: true,
    });

    expect(result).toEqual({
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "repo-default-profile",
    });
  });
});

describe("REGRESSION — getRuntimeSelectionForSubmit never sends an unresolved classic fallback", () => {
  test("REGRESSION-P2-001: unresolved fallback of classic is never sent as an explicit runtimeMode", () => {
    // If this regresses back to always sending effectiveRuntimeSelection,
    // runtimeMode would be "classic" here instead of undefined, and a
    // managed_runtime repo default could be silently overridden server-side.
    const result = getRuntimeSelectionForSubmit({
      effectiveRuntimeSelection: {
        runtimeMode: "classic",
        managedRuntimeProfileId: undefined,
      },
      hasExplicitUserSelection: false,
      repoDefaultsResolved: false,
    });
    expect(result.runtimeMode).not.toBe("classic");
    expect(result.runtimeMode).toBeUndefined();
  });
});
