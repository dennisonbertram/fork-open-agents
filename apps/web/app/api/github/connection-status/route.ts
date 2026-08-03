import { NextResponse } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import type { GitHubConnectionStatusResponse } from "@/lib/github/status";
import { syncUserInstallations } from "@/lib/github/sync";
import {
  logGitHubSyncAuthRequired,
  logGitHubSyncFailed,
} from "@/lib/github/sync-status-events";
import {
  classifyGitHubSyncError,
  describeGitHubSyncError,
} from "@/lib/github/sync-status";
import { getUserGitHubToken } from "@/lib/github/token";
import { getGitHubUsername, hasGitHubAccount } from "@/lib/github/users";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const [linked, installations] = await Promise.all([
    hasGitHubAccount(session.user.id),
    getInstallationsByUserId(session.user.id),
  ]);

  if (!linked) {
    return NextResponse.json({
      status: "not_connected",
      reason: null,
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: installations.length,
    } satisfies GitHubConnectionStatusResponse);
  }

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    return NextResponse.json({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: null,
    } satisfies GitHubConnectionStatusResponse);
  }

  try {
    const username = await getGitHubUsername(session.user.id);
    if (!username) {
      return NextResponse.json({
        status: "reconnect_required",
        reason: "sync_auth_failed",
        hasInstallations: installations.length > 0,
        syncedInstallationsCount: null,
      } satisfies GitHubConnectionStatusResponse);
    }

    const syncedInstallationsCount = await syncUserInstallations(
      session.user.id,
      token,
      username,
    );
    const reconnectRequired =
      installations.length > 0 && syncedInstallationsCount === 0;

    return NextResponse.json({
      status: reconnectRequired ? "reconnect_required" : "connected",
      reason: reconnectRequired ? "installations_missing" : null,
      hasInstallations: syncedInstallationsCount > 0,
      syncedInstallationsCount,
    } satisfies GitHubConnectionStatusResponse);
  } catch (error) {
    const errorKind = classifyGitHubSyncError(error);

    if (errorKind === "auth_required") {
      logGitHubSyncAuthRequired({
        userId: session.user.id,
        route: "connection-status",
      });

      return NextResponse.json({
        status: "reconnect_required",
        reason: "sync_auth_failed",
        hasInstallations: installations.length > 0,
        syncedInstallationsCount: null,
      } satisfies GitHubConnectionStatusResponse);
    }

    const { providerStatus } = describeGitHubSyncError(error);
    logGitHubSyncFailed({
      userId: session.user.id,
      route: "connection-status",
      providerStatus,
    });

    return NextResponse.json({
      status: "sync_degraded",
      reason: "sync_unknown_error",
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: null,
    } satisfies GitHubConnectionStatusResponse);
  }
}
