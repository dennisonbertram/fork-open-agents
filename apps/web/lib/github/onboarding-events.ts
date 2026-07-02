import type { GitHubConnectStatus } from "@/lib/github/connect-status";

/**
 * Lightweight structured logging for the pre-session GitHub connect/onboarding
 * flow (install/callback/post-link redirects into /get-started).
 *
 * No DB-backed session/chat exists yet for first-run users at this point in
 * the flow, so this intentionally does not use `emitSessionEvent`
 * (`@/lib/observability/events.ts`, which requires an existing session). This
 * is a `console`-based structured logger, matching the debug recipe
 * `grep '"service":"github-onboarding"'` documented in issue #781.
 */

const SERVICE = "github-onboarding" as const;

export type GitHubOnboardingRoute = "install" | "callback" | "post-link";

export function logGitHubRedirectIssued(params: {
  status: GitHubConnectStatus | string;
  route: GitHubOnboardingRoute;
  stepPreserved: boolean;
  userId: string;
}): void {
  console.log(
    JSON.stringify({
      service: SERVICE,
      event: "github-onboarding.redirect_issued",
      level: "info",
      status: params.status,
      route: params.route,
      stepPreserved: params.stepPreserved,
      userId: params.userId,
    }),
  );
}
