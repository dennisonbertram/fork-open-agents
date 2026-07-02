import { redirect } from "next/navigation";
import { needsOnboarding as checkNeedsOnboarding } from "@/lib/onboarding";

const ONBOARDING_GATE_TARGET = "/get-started?next=%2Fsessions";

type OnboardingCheckErrorKind = "onboarding_check_failed";

function logOnboardingGateEvent(
  event: string,
  level: "info" | "debug" | "error",
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({ event, level, ...fields });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Server-side onboarding guard for the /sessions route tree.
 *
 * Protected path: "First sign-in -> guided setup." A signed-in user who
 * has not linked GitHub or has no installations must be redirected to
 * /get-started before any session-shell UI renders.
 *
 * Fail-open by design: if the underlying checks throw (e.g. a transient
 * DB error), we log the failure and let the request through rather than
 * blocking a signed-in user's access to the app on an observability/DB
 * hiccup. This mirrors the existing `needsOnboarding` call sites, which do
 * not currently guard against thrown errors either.
 */
export async function requireOnboarded(userId: string): Promise<void> {
  let onboardingNeeded: boolean;

  try {
    onboardingNeeded = await checkNeedsOnboarding(userId);
  } catch (error) {
    const errorKind: OnboardingCheckErrorKind = "onboarding_check_failed";
    logOnboardingGateEvent("onboarding-gate.check_failed", "error", {
      userId,
      errorKind,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!onboardingNeeded) {
    logOnboardingGateEvent("onboarding-gate.pass", "debug", {
      userId,
      path: "/sessions",
    });
    return;
  }

  logOnboardingGateEvent("onboarding-gate.redirect", "info", {
    userId,
    fromPath: "/sessions",
    toPath: "/get-started",
  });

  redirect(ONBOARDING_GATE_TARGET);
}
