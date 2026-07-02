import { NextResponse } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { resolveGitHubReturnTarget } from "@/lib/github/connect-status";
import { getUserGitHubToken } from "@/lib/github/token";
import { getGitHubUsername } from "@/lib/github/users";
import { logGitHubRedirectIssued } from "@/lib/github/onboarding-events";
import { syncUserInstallations } from "@/lib/github/sync";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * After better-auth completes the GitHub OAuth link, it redirects here.
 * We sync installations and chain to the GitHub App install page if needed.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const requestUrl = new URL(req.url);
  const next = sanitizeInternalRedirect(
    requestUrl.searchParams.get("next"),
    "/sessions",
    req.url,
  );

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    const redirectUrl = resolveGitHubReturnTarget("link_failed", next, req.url);
    logGitHubRedirectIssued({
      status: "link_failed",
      route: "post-link",
      stepPreserved: redirectUrl.pathname === "/get-started",
      userId: session.user.id,
    });
    return NextResponse.redirect(redirectUrl);
  }

  // sync installations using the freshly-linked token
  const username = await getGitHubUsername(session.user.id);
  if (username) {
    try {
      const count = await syncUserInstallations(
        session.user.id,
        token,
        username,
      );

      if (count > 0) {
        const redirectUrl = resolveGitHubReturnTarget(
          "account_connected",
          next,
          req.url,
        );
        logGitHubRedirectIssued({
          status: "account_connected",
          route: "post-link",
          stepPreserved: redirectUrl.pathname === "/get-started",
          userId: session.user.id,
        });
        return NextResponse.redirect(redirectUrl);
      }
    } catch (error) {
      console.error("Failed syncing installations after GitHub link:", error);
    }
  }

  // no installations found — check if any exist in DB from a previous install
  const existingInstallations = await getInstallationsByUserId(session.user.id);
  if (existingInstallations.length > 0) {
    const redirectUrl = resolveGitHubReturnTarget(
      "account_connected",
      next,
      req.url,
    );
    logGitHubRedirectIssued({
      status: "account_connected",
      route: "post-link",
      stepPreserved: redirectUrl.pathname === "/get-started",
      userId: session.user.id,
    });
    return NextResponse.redirect(redirectUrl);
  }

  // no installations at all — route through the internal install flow so it can
  // preserve the intended destination across the GitHub App setup callback.
  const installUrl = new URL("/api/github/app/install", req.url);
  installUrl.searchParams.set("next", next);
  return NextResponse.redirect(installUrl);
}
