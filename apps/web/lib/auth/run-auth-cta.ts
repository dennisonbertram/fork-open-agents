import {
  classifyAuthCtaError,
  generateAuthCtaAttemptId,
  logAuthCtaFailed,
  logAuthCtaRetry,
  type AuthCta,
} from "./auth-cta-events";

export type RunAuthCtaSetters = {
  setPending: (value: boolean) => void;
  setError: (value: string | null) => void;
};

export type RunAuthCtaOptions = RunAuthCtaSetters & {
  cta: AuthCta;
  errorMessage: string;
  action: () => Promise<unknown>;
};

/**
 * Shared pending/error/retry contract for auth CTAs (#786): the Vercel
 * sign-in button, the settings GitHub connect button, and the get-started
 * GitHub connect step all wrap `authClient.signIn.social` /
 * `authClient.linkSocial` with this same try/catch/finally shape.
 *
 * This is a plain async function (not a hook) so it can be unit tested
 * directly with spy setters, mirroring the pattern used elsewhere in this
 * repo where no DOM/testing-library is available (see
 * repo-selector-compact.test.tsx). Each call site supplies its own
 * `useState` setters and action.
 *
 * On success (no throw), pending is intentionally left `true` — the caller
 * is expected to navigate away (redirect to the OAuth provider), so there is
 * no user-visible "success" idle state to return to.
 */
export async function runAuthCta({
  cta,
  errorMessage,
  action,
  setPending,
  setError,
}: RunAuthCtaOptions): Promise<void> {
  setError(null);
  setPending(true);
  const attemptId = generateAuthCtaAttemptId();
  try {
    await action();
  } catch (thrown) {
    setPending(false);
    setError(errorMessage);
    logAuthCtaFailed({
      cta,
      errorKind: classifyAuthCtaError(thrown),
      message: thrown instanceof Error ? thrown.message : String(thrown),
      attemptId,
    });
  }
}

export function retryAuthCta(options: RunAuthCtaOptions): Promise<void> {
  logAuthCtaRetry({ cta: options.cta });
  return runAuthCta(options);
}
