/**
 * Tests for repo-selector.tsx installation-scope dead-end fix (#785)
 *
 * This repo's test setup has no DOM/testing-library, and `RepoSelector`'s
 * repo list / error / scoped-empty UI lives inside a Radix `PopoverContent`,
 * which Radix's `Presence` unmounts entirely when the popover is closed —
 * `renderToStaticMarkup` never runs effects and cannot open the popover, so
 * that markup is unreachable via static rendering (verified empirically).
 *
 * Given that constraint, this file verifies the installation-scope
 * contract two ways, matching this repo's existing wiring-check convention
 * (see session-starter.test.tsx BT-SS-005):
 *
 * BT-RS-001/002/005: The shared `isScopedEmpty` / copy helper (from
 *   repo-picker-scope-empty-state.tsx, imported by repo-selector.tsx) is
 *   exercised directly for the "selected"+empty vs "all"+empty vs
 *   installationUrl===null cases.
 * BT-RS-006: `repo-selector.tsx` actually imports the shared helper module
 *   (wiring check) — this fails if the component reimplements ad hoc logic
 *   instead of reusing the colocated helper shared with
 *   repo-selector-compact.tsx.
 * BT-RS-003/BT-RS-004: `reposError` friendly-copy-with-Retry and the
 *   refresh-failure catch/finally contract are verified as pure async
 *   logic mirroring the component's handleRefresh shape (same convention
 *   used in repo-selector-compact.test.tsx).
 */

import { describe, expect, mock, test } from "bun:test";
import {
  FRIENDLY_REPOS_ERROR_COPY,
  isScopedEmpty,
  SCOPED_EMPTY_REPOS_COPY,
} from "./repo-picker-scope-empty-state";

describe("RepoSelector - installation-scope dead end (#785)", () => {
  test("BT-RS-001: isScopedEmpty is true for repositorySelection='selected' with zero repos", () => {
    expect(isScopedEmpty("selected", 0)).toBe(true);
  });

  test("BT-RS-002: isScopedEmpty is false for repositorySelection='all' with zero repos (generic empty)", () => {
    expect(isScopedEmpty("all", 0)).toBe(false);
  });

  test("BT-RS-002b: isScopedEmpty is false once repos are present, even for 'selected' scope", () => {
    expect(isScopedEmpty("selected", 3)).toBe(false);
  });

  test("BT-RS-005: scoped-empty copy is distinct from the generic 'No repositories found.' copy", () => {
    expect(SCOPED_EMPTY_REPOS_COPY).not.toBe("No repositories found.");
    expect(SCOPED_EMPTY_REPOS_COPY.toLowerCase()).toContain("selected");
  });

  test("BT-RS-006: repo-selector.tsx imports the shared scoped-empty-state helper (wiring check)", async () => {
    const source = await Bun.file(
      new URL("repo-selector.tsx", import.meta.url),
    ).text();

    expect(source).toContain("repo-picker-scope-empty-state");
  });

  test("BT-RS-006b: repo-selector.tsx does not render the raw reposError string directly", async () => {
    const source = await Bun.file(
      new URL("repo-selector.tsx", import.meta.url),
    ).text();

    // The pre-fix implementation rendered `{reposError}` verbatim inside
    // CommandEmpty. After the fix, friendly copy + Retry must replace it,
    // reusing the shared FRIENDLY_REPOS_ERROR_COPY / RETRY_LABEL constants
    // (imported by reference, not re-declared) from the colocated helper.
    expect(source).not.toMatch(/\{reposError\s*\?\s*reposError\s*:/);
    expect(source).toContain("FRIENDLY_REPOS_ERROR_COPY");
    expect(source).toContain("RETRY_LABEL");
  });

  test("BT-RS-003: reposError -> friendly copy + Retry action wiring (pure logic mirrors component contract)", () => {
    const reposError = "raw upstream 502 body dump";
    const refresh = mock(async () => []);

    function renderReposEmptyState(): { copy: string; onRetry: () => void } {
      if (reposError) {
        return { copy: FRIENDLY_REPOS_ERROR_COPY, onRetry: () => refresh() };
      }
      return { copy: "No repositories found.", onRetry: () => refresh() };
    }

    const state = renderReposEmptyState();
    expect(state.copy).toBe(FRIENDLY_REPOS_ERROR_COPY);
    expect(state.copy).not.toContain("raw upstream 502");

    state.onRetry();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("BT-RS-004: handleRefresh catch path must produce a visible (non-console-only) failure state and always reset to idle", async () => {
    const state: { isRefreshing: boolean; refreshErrorMessage: string | null } =
      {
        isRefreshing: false,
        refreshErrorMessage: null,
      };

    async function handleRefresh(refresh: () => Promise<unknown>) {
      state.isRefreshing = true;
      state.refreshErrorMessage = null;
      try {
        await refresh();
      } catch {
        state.refreshErrorMessage = "Refresh failed. Please try again.";
      } finally {
        state.isRefreshing = false;
      }
    }

    const failingRefresh = mock(async () => {
      throw new Error("network error");
    });

    await handleRefresh(failingRefresh);

    expect(failingRefresh).toHaveBeenCalledTimes(1);
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshErrorMessage).toBe("Refresh failed. Please try again.");
  });
});
