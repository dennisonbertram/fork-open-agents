"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared inline error + retry affordance for auth CTAs (#786): the Vercel
 * sign-in button, the settings GitHub connect button, and the get-started
 * GitHub connect step all converge on the same local-rejection UI.
 *
 * `aria-live="polite"` announces the error without stealing focus; the
 * retry button re-invokes the same handler that failed.
 */
export function AuthCtaError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mt-2 flex items-center gap-2 text-xs text-destructive"
    >
      <AlertCircle className="size-3.5 shrink-0" />
      <span>{message}</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs text-destructive underline"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
