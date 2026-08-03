/**
 * Regression tests for useSession error surfacing.
 *
 * BT-001: A failed /api/auth/info check is distinguishable from a signed-out
 *         user through the hook's return value.
 * BT-002: A genuine 401 "Not authenticated" is a sign-out answer, not a failed
 *         check (providers.tsx already signs the user out on that error).
 * BT-003: Existing field names/meanings are unchanged for the happy path.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { FetchError } from "@/lib/swr";
import type { SessionUserInfo } from "@/lib/session/types";

type SwrState = {
  data?: SessionUserInfo | undefined;
  error?: Error | null;
  isLoading?: boolean;
};

let swrState: SwrState = {};

mock.module("swr", () => ({
  default: () => ({
    data: swrState.data,
    error: swrState.error ?? null,
    isLoading: swrState.isLoading ?? false,
    mutate: () => Promise.resolve(undefined),
  }),
}));

const modulePromise = import("./use-session");

const SIGNED_IN: SessionUserInfo = {
  user: { id: "u1", name: "Ada", email: "ada@example.com", image: null },
  isAdmin: false,
  hasGitHub: true,
  hasGitHubAccount: true,
  hasGitHubInstallations: true,
} as unknown as SessionUserInfo;

beforeEach(() => {
  swrState = {};
});

describe("useSession", () => {
  test("BT-001: a failed auth check is distinguishable from signed out", async () => {
    const { useSession } = await modulePromise;

    swrState = { data: undefined, error: null, isLoading: false };
    const signedOut = useSession();

    swrState = {
      data: undefined,
      error: new FetchError("Internal Server Error", 500),
      isLoading: false,
    };
    const failedCheck = useSession();

    // Both look identical on the legacy fields -- that is the bug.
    expect(signedOut.session).toBeNull();
    expect(signedOut.isAuthenticated).toBe(false);
    expect(failedCheck.session).toBeNull();
    expect(failedCheck.isAuthenticated).toBe(false);

    // The hook must expose something that tells them apart.
    expect(signedOut.isError).toBe(false);
    expect(signedOut.error).toBeNull();
    expect(failedCheck.isError).toBe(true);
    expect(failedCheck.error).toBeInstanceOf(FetchError);
  });

  test("BT-002: a 401 Not authenticated is a sign-out, not a failed check", async () => {
    const { useSession } = await modulePromise;

    swrState = {
      data: undefined,
      error: new FetchError("Not authenticated", 401),
      isLoading: false,
    };
    const result = useSession();

    expect(result.isAuthenticated).toBe(false);
    expect(result.isError).toBe(false);
  });

  test("BT-003: existing fields keep their meaning when signed in", async () => {
    const { useSession } = await modulePromise;

    swrState = { data: SIGNED_IN, error: null, isLoading: false };
    const result = useSession();

    expect(result.session).toBe(SIGNED_IN);
    expect(result.loading).toBe(false);
    expect(result.isAuthenticated).toBe(true);
    expect(result.isAdmin).toBe(false);
    expect(result.hasGitHub).toBe(true);
    expect(result.hasGitHubAccount).toBe(true);
    expect(result.hasGitHubInstallations).toBe(true);
    expect(result.isError).toBe(false);
  });
});

describe("a failed revalidation on top of cached data", () => {
  // Raised in review of #1087: SWR preserves `data` when a revalidation fails,
  // so an authenticated user whose background refresh blips must not be shown
  // the error branch — consumers unmount authenticated content on isError.
  test("keeps the user authenticated and does not report an error state", async () => {
    const { useSession } = await modulePromise;
    swrState = {
      data: SIGNED_IN,
      error: new Error("network blip during revalidation"),
      isLoading: false,
    };

    const result = useSession();

    expect(result.isAuthenticated).toBe(true);
    expect(result.isError).toBe(false);
    // The raw error stays exposed, so a surface can show a subtle "couldn't
    // refresh" hint without tearing the page down.
    expect(result.error).toBeInstanceOf(Error);
  });
});
