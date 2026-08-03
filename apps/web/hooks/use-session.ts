"use client";

import useSWR from "swr";
import type { SessionUserInfo } from "@/lib/session/types";
import { FetchError, fetcher } from "@/lib/swr";

/**
 * A 401 "Not authenticated" is the API saying "signed out", and
 * `app/providers.tsx` already signs the user out globally on it. Every other
 * failure (500, network blip, dependency down) means the auth check itself
 * failed and must not be rendered as a sign-out (#1086).
 */
function isFailedAuthCheck(error: unknown): boolean {
  if (!error) {
    return false;
  }
  return !(
    error instanceof FetchError &&
    error.status === 401 &&
    error.message === "Not authenticated"
  );
}

export function useSession() {
  const { data, isLoading, error, mutate } = useSWR<SessionUserInfo>(
    "/api/auth/info",
    fetcher,
    {
      revalidateOnFocus: true,
    },
  );

  return {
    session: data ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    isAdmin: data?.isAdmin ?? false,
    hasGitHub: data?.hasGitHub ?? false,
    hasGitHubAccount: data?.hasGitHubAccount ?? false,
    hasGitHubInstallations: data?.hasGitHubInstallations ?? false,
    /** Raw SWR error, including the 401 sign-out signal. */
    error: (error as Error | undefined) ?? null,
    /**
     * True only when the auth check failed for a reason that is not a sign-out
     * AND there is no usable cached session to fall back on.
     *
     * SWR keeps `data` when a revalidation fails, so an authenticated user
     * whose focus-triggered refresh blips would otherwise get both
     * isAuthenticated: true and isError: true — and consumers that check the
     * error branch first would unmount working authenticated UI over a
     * transient background failure. A failed refresh on top of good data is
     * not a reason to throw the good data away.
     */
    isError: isFailedAuthCheck(error) && !data,
    /** Re-run the auth check, for a user-facing retry affordance. */
    retry: () => {
      void mutate();
    },
  };
}
