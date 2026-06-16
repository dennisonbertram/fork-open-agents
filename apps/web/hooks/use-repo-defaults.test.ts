/**
 * Tests for useRepoDefaults hook (TASK-PREFILL)
 *
 * BT-001: Returns parsed resolved defaults from successful GET response
 * BT-002: No fetch is issued when enabled=false
 * BT-003: Returns undefined defaults on non-ok response (error surfaced, no crash)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ResolvedRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";

// ── SWR mock state ─────────────────────────────────────────────────────────────

type SwrState = {
  data?: { resolved: ResolvedRepoDefaults; raw: unknown } | undefined;
  error?: Error | null;
  isLoading?: boolean;
};

let swrState: SwrState = {};
let lastSwrKey: unknown = "NOT_CALLED";

mock.module("swr", () => ({
  default: (key: unknown) => {
    lastSwrKey = key;
    return {
      data: swrState.data,
      error: swrState.error ?? null,
      isLoading: swrState.isLoading ?? false,
    };
  },
}));

// ── Lazy-import after mocks are wired ─────────────────────────────────────────

const modulePromise = import("./use-repo-defaults");

const SAMPLE_RESOLVED: ResolvedRepoDefaults = {
  autoCommitPush: true,
  autoCreatePr: true,
  managedRuntimeProfileId: "default",
  runtimeMode: "classic",
  vcpus: 2,
  fullClone: false,
  prewarmEnabled: false,
  defaultBranch: "main",
  isNewBranch: false,
};

describe("useRepoDefaults", () => {
  beforeEach(() => {
    swrState = {};
    lastSwrKey = "NOT_CALLED";
  });

  // BT-001: Returns parsed resolved defaults on success
  test("BT-001: returns defaults.resolved when the fetch succeeds", async () => {
    swrState = { data: { resolved: SAMPLE_RESOLVED, raw: null }, isLoading: false };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "acme",
      repoName: "my-repo",
    });
    expect(result.defaults).toEqual(SAMPLE_RESOLVED);
    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
  });

  // BT-002: No fetch when disabled — SWR key is null
  test("BT-002: does not fetch when enabled=false (SWR key is null)", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({ enabled: false, repoOwner: "acme", repoName: "my-repo" });
    expect(lastSwrKey).toBeNull();
  });

  // BT-002b: No fetch when owner/repoName are empty strings
  test("BT-002b: does not fetch when repoOwner is empty (SWR key is null)", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({ enabled: true, repoOwner: "", repoName: "my-repo" });
    expect(lastSwrKey).toBeNull();
  });

  // BT-003: Error response → defaults is undefined, error is surfaced
  test("BT-003: returns undefined defaults when SWR reports an error", async () => {
    swrState = {
      data: undefined,
      error: new Error("Failed to load repository settings"),
      isLoading: false,
    };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "acme",
      repoName: "my-repo",
    });
    expect(result.defaults).toBeUndefined();
    expect(result.error).toBe("Failed to load repository settings");
  });

  // Loading state is passed through
  test("returns loading=true while SWR is fetching", async () => {
    swrState = { data: undefined, isLoading: true };
    const { useRepoDefaults } = await modulePromise;
    const result = useRepoDefaults({
      enabled: true,
      repoOwner: "acme",
      repoName: "my-repo",
    });
    expect(result.loading).toBe(true);
    expect(result.defaults).toBeUndefined();
  });

  // SWR key includes encoded owner+name
  test("SWR key encodes repoOwner and repoName into the API path", async () => {
    swrState = {};
    const { useRepoDefaults } = await modulePromise;
    useRepoDefaults({ enabled: true, repoOwner: "acme", repoName: "my-repo" });
    expect(typeof lastSwrKey).toBe("string");
    const key = lastSwrKey as string;
    expect(key).toContain("acme");
    expect(key).toContain("my-repo");
    expect(key).toContain("/api/settings/repositories/");
  });
});
