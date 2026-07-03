/**
 * Client-side observability for auth CTA pending/error/retry state (#786).
 *
 * There is no client-side structured log sink in this repo today — this
 * module intentionally logs to `console.warn` / `console.info` as the
 * best-available signal rather than inventing a sink. When a client log
 * pipeline exists, replace the bodies of `logAuthCtaFailed` /
 * `logAuthCtaRetry` with calls into it; call sites should not need to change.
 *
 * Debug recipe (today): open the browser console and filter for
 * `"auth_cta_failed"` or `"auth_cta_retry"`.
 */

export type AuthCta =
  | "vercel_signin"
  | "github_link_settings"
  | "github_link_get_started";

export type AuthCtaErrorKind =
  | "provider_rejected"
  | "network_error"
  | "unknown";

export function generateAuthCtaAttemptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function classifyAuthCtaError(error: unknown): AuthCtaErrorKind {
  if (error instanceof TypeError) {
    return "network_error";
  }
  if (error instanceof Error) {
    return "network_error";
  }
  return "unknown";
}

export function logAuthCtaFailed(fields: {
  cta: AuthCta;
  errorKind: AuthCtaErrorKind;
  message: string;
  attemptId?: string;
}): void {
  console.warn("auth_cta_failed", fields);
}

export function logAuthCtaRetry(fields: {
  cta: AuthCta;
  attemptId?: string;
}): void {
  console.info("auth_cta_retry", fields);
}
