/**
 * Regression tests for useRepoDefaults hook (TASK-PREFILL)
 *
 * These tests would fail if the implementation in fadbc70a is reverted.
 *
 * REGRESSION-001: Hook returns undefined defaults when disabled, not stale data
 * REGRESSION-002: SWR key changes when owner/name change (no stale data served)
 * REGRESSION-003: Non-ok HTTP status results in undefined defaults + error string
 * REGRESSION-004: Empty repoName prevents fetch (guards against accidental wildcard URLs)
 * REGRESSION-005: Fetch error message propagates exactly as the error string
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ResolvedRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";

// ── SWR mock ───────────────────────────────────────────────────────────────────

type SwrState = {
  data?: { resolved: ResolvedRepoDefaults; raw: unknown } | undefined;
  error?: Error | null;
  isLoading?: boolean;
};

let swrState: SwrState = {};
let capturedKey: unknown = "NOT_CALLED";

mock.module("swr", () => ({
  default: (key: unknown) => {
    capturedKey = key;
    // Simulate SWR's null-key behavior: null key means no fetch, data stays undefined
    if (key === null) {
      return { data: undefined, error: null, isLoading: false };
    }
    return {
      data: swrState.data,
      error: swrState.error ?? null,
      isLoading: swrState.isLoading ?? false,
    };
  },
}));

const modulePromise = import("./use-repo-defaults");

const SAMPLE_RESOLVED: ResolvedRepoDefaults = {
  autoCommitPush: true,
  autoCreatePr: false,
  managedRuntimeProfileId: "default",
  runtimeMode: "managed_runtime",
  vcpus: 4,
  fullClone: true,
  prewarmEnabled: true,
  defaultBranch: "release/1.0",
  isNewBranch: true,
};

describe("useRepoDefaults regression coverage", () => {
  beforeEach(() => {
    swrState = {};
    capturedKey = "NOT_CALLED";
  });

  // REGRESSION-001: disabled always yields undefined defaults regardless of data
  test("REGRESSION-001: returns undefined defaults when enabled=false even if SWR has cached data", async () => {
    // Simulate stale SWR cache returning data when hook should be disabled
    swrState = { data: { resolved: SAMPLE_RESOLVED, raw: null } };
    const { useRepoDefaults } = await modulePromise;

    const result = useRepoDefaults({
      enabled: false,
      repoOwner: "acme",
      repoName: "my-repo",
    });

    // Key must be null (SWR won't fetch)
    expect(capturedKey).toBeNull();
    // Data returned by the hook must reflect the null-key state (undefined)
    // If someone removes the null-key guard, SWR returns cached data instead.
    // The hook currently passes null key — SWR returns undefined data for null keys.
    expect(result.defaults).toBeUndefined();
  });

  // REGRESSION-002: SWR key changes between different owner/name combos
  test("REGRESSION-002: SWR key is different for different owner+name pairs", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;

    useRepoDefaults({ enabled: true, repoOwner: "org-a", repoName: "repo-x" });
    const keyA = capturedKey as string;

    useRepoDefaults({ enabled: true, repoOwner: "org-b", repoName: "repo-y" });
    const keyB = capturedKey as string;

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("org-a");
    expect(keyA).toContain("repo-x");
    expect(keyB).toContain("org-b");
    expect(keyB).toContain("repo-y");
  });

  // REGRESSION-003: Error is surfaced as string, not thrown/uncaught
  test("REGRESSION-003: HTTP error from SWR error is returned as error string, defaults is undefined", async () => {
    swrState = {
      data: undefined,
      error: new Error("401 Unauthorized"),
    };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "acme",
      repoName: "secure-repo",
    });
    expect(result.defaults).toBeUndefined();
    expect(result.error).toBe("401 Unauthorized");
    expect(result.loading).toBe(false);
  });

  // REGRESSION-004: Empty repoName prevents fetch
  test("REGRESSION-004: empty repoName produces null SWR key (no fetch)", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({ enabled: true, repoOwner: "acme", repoName: "" });
    expect(capturedKey).toBeNull();
  });

  // REGRESSION-005: API path includes both owner and name
  test("REGRESSION-005: API path includes /api/settings/repositories/:owner/:name", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({
      enabled: true,
      repoOwner: "myorg",
      repoName: "my-service",
    });
    expect(typeof capturedKey).toBe("string");
    expect(capturedKey as string).toMatch(
      /\/api\/settings\/repositories\/myorg\/my-service/,
    );
  });

  // REGRESSION-006: Special characters in owner/name are URL-encoded
  test("REGRESSION-006: owner and repoName are URL-encoded in the SWR key", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({
      enabled: true,
      repoOwner: "org with spaces",
      repoName: "repo/with/slashes",
    });
    const key = capturedKey as string;
    expect(key).not.toContain("org with spaces");
    expect(key).not.toContain("repo/with/slashes");
    expect(key).toContain("org%20with%20spaces");
    expect(key).toContain("repo%2Fwith%2Fslashes");
  });

  // REGRESSION-007: Returns repoDefaults.isNewBranch correctly (non-boolean coercion)
  test("REGRESSION-007: resolved.isNewBranch is returned faithfully through the hook", async () => {
    swrState = {
      data: { resolved: { ...SAMPLE_RESOLVED, isNewBranch: true }, raw: null },
    };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "x",
      repoName: "y",
    });
    expect(result.defaults?.isNewBranch).toBe(true);
  });

  test("REGRESSION-007b: resolved.defaultBranch is returned faithfully", async () => {
    swrState = {
      data: {
        resolved: { ...SAMPLE_RESOLVED, defaultBranch: "release/1.0" },
        raw: null,
      },
    };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "x",
      repoName: "y",
    });
    expect(result.defaults?.defaultBranch).toBe("release/1.0");
  });
});
