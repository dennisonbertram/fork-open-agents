"use client";

import { Loader2 } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { runAuthCta } from "@/lib/auth/run-auth-cta";
import { AuthCtaError } from "./auth-cta-error";

export const SIGN_IN_ERROR_MESSAGE = "Sign-in didn't start. Try again.";

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 1L24 22H0L12 1Z" />
    </svg>
  );
}

function resolveRedirectPath(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return window.location.pathname + window.location.search;
  }

  return window.location.pathname + window.location.search;
}

type SignInButtonProps = {
  callbackUrl?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">;

export function SignInButton({
  callbackUrl,
  disabled,
  ...props
}: SignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // better-auth appends `?error=<code>` to whatever `errorCallbackURL` is
  // given (see better-auth's oauth2/state.mjs), so this only needs to be the
  // current page — the landing page (SignedOutHero) reads that `error`
  // param and renders the "sign-in didn't complete" state.
  function resolveErrorCallbackUrl(): string | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }
    return `${window.location.origin}${window.location.pathname}`;
  }

  function handleSignIn() {
    if (disabled || isLoading) {
      return;
    }

    const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const redirectPath = resolveRedirectPath(callbackUrl ?? fallback);
    const errorCallbackURL = resolveErrorCallbackUrl();

    void runAuthCta({
      cta: "vercel_signin",
      errorMessage: SIGN_IN_ERROR_MESSAGE,
      action: () =>
        authClient.signIn.social({
          provider: "vercel",
          callbackURL: redirectPath,
          ...(errorCallbackURL ? { errorCallbackURL } : {}),
        }),
      setPending: setIsLoading,
      setError,
    });
  }

  return (
    <div>
      <Button
        {...props}
        aria-busy={isLoading}
        disabled={disabled || isLoading}
        onClick={handleSignIn}
      >
        {isLoading ? <Loader2 className="animate-spin" /> : <VercelIcon />}
        {isLoading ? "Signing in..." : "Sign in with Vercel"}
      </Button>
      {error ? <AuthCtaError message={error} onRetry={handleSignIn} /> : null}
    </div>
  );
}
