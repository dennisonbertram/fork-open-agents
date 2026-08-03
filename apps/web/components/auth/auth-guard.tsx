"use client";

import { useSession } from "@/hooks/use-session";
import { AuthCtaError } from "./auth-cta-error";
import { SignInButton } from "./sign-in-button";

export function AuthGuard({
  children,
  loadingFallback,
  unauthenticatedFallback,
}: {
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
  unauthenticatedFallback?: React.ReactNode;
}) {
  const { loading, isAuthenticated, isError, retry } = useSession();

  if (loading) {
    return <>{loadingFallback ?? <div>Loading...</div>}</>;
  }

  // #1086: the auth check failed for a reason that is not a sign-out. Showing
  // the sign-in prompt here would tell a signed-in user they are signed out.
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <AuthCtaError
          message="We couldn't verify your session."
          onRetry={retry}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        {unauthenticatedFallback ?? (
          <div className="flex flex-col items-center gap-4 p-8">
            <p>Please sign in to continue</p>
            <SignInButton />
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}
