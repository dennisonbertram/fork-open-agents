import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { logInstallStateRejected } from "@/app/api/github/app/callback/log";
import { resolveGitHubReturnTarget } from "@/lib/github/connect-status";
import { logGitHubRedirectIssued } from "@/lib/github/onboarding-events";
import { syncUserInstallations } from "@/lib/github/sync";
import {
  classifyGitHubSyncError,
  describeGitHubSyncError,
} from "@/lib/github/sync-status";
import {
  logGitHubSyncAuthRequired,
  logGitHubSyncFailed,
} from "@/lib/github/sync-status-events";
import { getUserGitHubToken } from "@/lib/github/token";
import { getGitHubUsername } from "@/lib/github/users";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";
import { getServerSession } from "@/lib/session/get-server-session";

function isMatchingState(
  cookieValue: string | undefined,
  paramValue: string | null,
): boolean {
  if (!(cookieValue && paramValue)) {
    return false;
  }

  const cookieBuffer = Buffer.from(cookieValue);
  const paramBuffer = Buffer.from(paramValue);

  if (cookieBuffer.length !== paramBuffer.length) {
    return false;
  }

  return timingSafeEqual(cookieBuffer, paramBuffer);
}

function parseInstallationId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const installationId = Number.parseInt(value, 10);
  if (!Number.isFinite(installationId)) {
    return null;
  }

  return installationId;
}

function redirectAndClearCookies(url: string | URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.delete("github_app_install_redirect_to");
  response.cookies.delete("github_app_install_state");
  response.cookies.delete("github_reconnect");
  return response;
}

/**
 * GitHub App Setup URL callback — handles installation sync only.
 * OAuth token exchange is handled by better-auth at /api/auth/callback/github.
 */
export async function GET(req: Request): Promise<Response> {
  const cookieStore = await cookies();
  const redirectTo = sanitizeInternalRedirect(
    cookieStore.get("github_app_install_redirect_to")?.value,
    "/get-started",
    req.url,
  );

  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const requestUrl = new URL(req.url);
  const installationId = parseInstallationId(
    requestUrl.searchParams.get("installation_id"),
  );
  const setupAction = requestUrl.searchParams.get("setup_action");

  const stateCookieValue = cookieStore.get("github_app_install_state")?.value;
  const stateParamValue = requestUrl.searchParams.get("state");

  if (!isMatchingState(stateCookieValue, stateParamValue)) {
    logInstallStateRejected({
      userId: session.user.id,
      hasCookie: Boolean(stateCookieValue),
      hasParam: Boolean(stateParamValue),
    });
    // invalid_state is a non-success status: reroute to /get-started (with
    // step=github + next preserved) so the status notice actually renders.
    const redirectUrl = resolveGitHubReturnTarget(
      "invalid_state",
      redirectTo,
      req.url,
    );
    return redirectAndClearCookies(redirectUrl);
  }

  // get the user's github token from better-auth
  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    const redirectUrl = resolveGitHubReturnTarget(
      "not_linked",
      redirectTo,
      req.url,
    );
    logGitHubRedirectIssued({
      status: "not_linked",
      route: "callback",
      stepPreserved: redirectUrl.pathname === "/get-started",
      userId: session.user.id,
    });
    return redirectAndClearCookies(redirectUrl);
  }

  // sync installations
  let syncedInstallationsCount: number | null = null;
  let syncFailed = false;
  let syncAuthRequired = false;
  const username = await getGitHubUsername(session.user.id);

  if (username) {
    try {
      syncedInstallationsCount = await syncUserInstallations(
        session.user.id,
        token,
        username,
      );
    } catch (error) {
      const errorKind = classifyGitHubSyncError(error);

      if (errorKind === "auth_required") {
        syncAuthRequired = true;
        logGitHubSyncAuthRequired({
          userId: session.user.id,
          route: "callback",
        });
      } else {
        syncFailed = true;
        const { providerStatus } = describeGitHubSyncError(error);
        logGitHubSyncFailed({
          userId: session.user.id,
          route: "callback",
          providerStatus,
        });
      }
    }
  }

  let githubStatus: string;
  let missingInstallationId = false;
  if (syncAuthRequired) {
    githubStatus = "not_linked";
  } else if (syncFailed) {
    githubStatus = "sync_failed";
  } else if (setupAction === "request") {
    githubStatus = "request_sent";
  } else if ((syncedInstallationsCount ?? 0) > 0) {
    githubStatus = "app_installed";
  } else if (!installationId) {
    githubStatus = "no_action";
    missingInstallationId = true;
  } else {
    githubStatus = "pending_sync";
  }

  const redirectUrl = resolveGitHubReturnTarget(
    githubStatus,
    redirectTo,
    req.url,
    { missingInstallationId },
  );
  logGitHubRedirectIssued({
    status: githubStatus,
    route: "callback",
    stepPreserved: redirectUrl.pathname === "/get-started",
    userId: session.user.id,
  });
  return redirectAndClearCookies(redirectUrl);
}
