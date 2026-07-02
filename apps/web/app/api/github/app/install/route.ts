import { generateState } from "arctic";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
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
import {
  getGitHubAccountId,
  getGitHubUsername,
  hasGitHubAccount,
} from "@/lib/github/users";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";
import { getServerSession } from "@/lib/session/get-server-session";

const COOKIE_OPTIONS = {
  path: "/",
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  maxAge: 60 * 15,
  sameSite: "lax" as const,
};

function redirectWithInstallCookies(
  url: string | URL,
  redirectTo: string,
  state: string,
): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.set(
    "github_app_install_redirect_to",
    redirectTo,
    COOKIE_OPTIONS,
  );
  response.cookies.set("github_app_install_state", state, COOKIE_OPTIONS);
  return response;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  const redirectTo = sanitizeInternalRedirect(
    req.nextUrl.searchParams.get("next"),
    "/get-started",
    req.url,
  );

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appSlug) {
    const fallbackUrl = resolveGitHubReturnTarget(
      "app_not_configured",
      redirectTo,
      req.url,
    );
    logGitHubRedirectIssued({
      status: "app_not_configured",
      route: "install",
      stepPreserved: fallbackUrl.pathname === "/get-started",
      userId: session.user.id,
    });
    return NextResponse.redirect(fallbackUrl);
  }

  const state = generateState();

  // no linked github account — redirect to get-started to connect first.
  // This check must run before the target_id branch below (issue #783): an
  // unlinked user hitting target_id must never reach a
  // github.com/apps/.../installations/new URL.
  const linked = await hasGitHubAccount(session.user.id);
  if (!linked) {
    const connectUrl = resolveGitHubReturnTarget(
      "not_linked",
      redirectTo,
      req.url,
    );
    logGitHubRedirectIssued({
      status: "not_linked",
      route: "install",
      stepPreserved: true,
      userId: session.user.id,
    });
    return NextResponse.redirect(connectUrl);
  }

  // if a specific target_id is provided, go directly to install for that account
  const targetId = req.nextUrl.searchParams.get("target_id");
  if (targetId && /^\d+$/.test(targetId)) {
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new/permissions`,
    );
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("target_id", targetId);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  // reconnect mode — skip account picker, target the user's personal account
  const reconnect = req.nextUrl.searchParams.get("reconnect");
  if (reconnect === "1") {
    const accountId = await getGitHubAccountId(session.user.id);
    if (accountId) {
      const installUrl = new URL(
        `https://github.com/apps/${appSlug}/installations/new/permissions`,
      );
      installUrl.searchParams.set("state", state);
      installUrl.searchParams.set("target_id", accountId);
      return redirectWithInstallCookies(installUrl, redirectTo, state);
    }
  }

  // try to sync installations
  let installations = await getInstallationsByUserId(session.user.id);

  if (installations.length === 0) {
    try {
      const token = await getUserGitHubToken(session.user.id);
      const username = await getGitHubUsername(session.user.id);
      if (token && username) {
        await syncUserInstallations(session.user.id, token, username);
        installations = await getInstallationsByUserId(session.user.id);
      }
    } catch (error) {
      const errorKind = classifyGitHubSyncError(error);

      if (errorKind === "auth_required") {
        logGitHubSyncAuthRequired({
          userId: session.user.id,
          route: "install",
        });
      } else {
        const { providerStatus } = describeGitHubSyncError(error);
        logGitHubSyncFailed({
          userId: session.user.id,
          route: "install",
          providerStatus,
        });

        const syncFailedUrl = resolveGitHubReturnTarget(
          "sync_failed",
          redirectTo,
          req.url,
        );
        logGitHubRedirectIssued({
          status: "sync_failed",
          route: "install",
          stepPreserved: syncFailedUrl.pathname === "/get-started",
          userId: session.user.id,
        });
        return NextResponse.redirect(syncFailedUrl);
      }
    }
  }

  if (installations.length === 0) {
    // no installations — route to install page
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new/permissions`,
    );
    installUrl.searchParams.set("state", state);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  // already has installations — show account/org picker for additional installs
  const installUrl = new URL(
    `https://github.com/apps/${appSlug}/installations/select_target`,
  );
  installUrl.searchParams.set("state", state);
  return redirectWithInstallCookies(installUrl, redirectTo, state);
}
