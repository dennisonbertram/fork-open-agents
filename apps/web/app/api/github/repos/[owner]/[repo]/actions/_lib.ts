import "server-only";

import type { Octokit } from "@octokit/rest";
import { nanoid } from "nanoid";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { withScopedInstallationOctokit } from "@/lib/github/app";
import { verifyRepoAccess } from "@/lib/github/access";
import {
  classifyActionsReadError,
  classifyActionsWriteError,
  statusForDashboardErrorKind,
} from "@/lib/github/actions-manager/errors";
import { getActionsManagerReadinessCheck } from "@/lib/github/actions-manager/readiness";
import type { DashboardErrorKind } from "@/lib/github/repo-dashboard";

export type ActionsRouteContext = {
  params: Promise<{ owner: string; repo: string }>;
};

type AccessOk = {
  userId: string;
  owner: string;
  repo: string;
  installationId: number;
  repositoryId: number;
  requestId: string;
};

function jsonError(errorKind: DashboardErrorKind, status?: number): Response {
  return Response.json(
    {
      ok: false,
      errorKind,
      error: errorKind,
    },
    { status: status ?? statusForDashboardErrorKind(errorKind) },
  );
}

function repoAccessErrorKind(reason: string): DashboardErrorKind {
  if (reason === "no_user_token") return "github_not_connected";
  if (reason === "no_installation") return "installation_missing";
  if (reason === "app_no_access") return "app_no_access";
  return "repo_access_denied";
}

export async function requireActionsReadAccess(
  context: ActionsRouteContext,
): Promise<{ ok: true; access: AccessOk } | { ok: false; response: Response }> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const { owner, repo } = await context.params;
  const repoAccess = await verifyRepoAccess({
    userId: authResult.userId,
    owner,
    repo,
    requiredUserPermission: "read",
  });

  if (!repoAccess.ok) {
    return {
      ok: false,
      response: jsonError(repoAccessErrorKind(repoAccess.reason)),
    };
  }

  const readiness = await getActionsManagerReadinessCheck({
    installationId: repoAccess.installationId,
    repositoryId: repoAccess.repositoryId,
  });

  if (readiness.status !== "ready") {
    return {
      ok: false,
      response: jsonError(
        readiness.errorKind ?? "app_no_actions_permission",
        readiness.errorKind === "provider_unavailable" ? 503 : 403,
      ),
    };
  }

  return {
    ok: true,
    access: {
      userId: authResult.userId,
      owner,
      repo,
      installationId: repoAccess.installationId,
      repositoryId: repoAccess.repositoryId,
      requestId: nanoid(),
    },
  };
}

export async function withActionsReadOctokit<T>(
  access: AccessOk,
  operation: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  return withScopedInstallationOctokit({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    permissions: { actions: "read", metadata: "read" },
    operation,
  });
}

export function handleActionsRouteError(error: unknown): Response {
  const errorKind = classifyActionsReadError(error);
  return jsonError(errorKind);
}

export function handleActionsWriteRouteError(error: unknown): Response {
  const errorKind = classifyActionsWriteError(error);
  return jsonError(errorKind);
}

export async function requireActionsWriteAccess(
  context: ActionsRouteContext,
): Promise<{ ok: true; access: AccessOk } | { ok: false; response: Response }> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const { owner, repo } = await context.params;
  const repoAccess = await verifyRepoAccess({
    userId: authResult.userId,
    owner,
    repo,
    requiredUserPermission: "read",
  });

  if (!repoAccess.ok) {
    return {
      ok: false,
      response: jsonError(repoAccessErrorKind(repoAccess.reason)),
    };
  }

  const readiness = await getActionsManagerReadinessCheck({
    installationId: repoAccess.installationId,
    repositoryId: repoAccess.repositoryId,
  });

  if (readiness.status !== "ready") {
    return {
      ok: false,
      response: jsonError(
        readiness.errorKind ?? "app_no_actions_permission",
        readiness.errorKind === "provider_unavailable" ? 503 : 403,
      ),
    };
  }

  return {
    ok: true,
    access: {
      userId: authResult.userId,
      owner,
      repo,
      installationId: repoAccess.installationId,
      repositoryId: repoAccess.repositoryId,
      requestId: nanoid(),
    },
  };
}

export async function withActionsWriteOctokit<T>(
  access: AccessOk,
  operation: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  return withScopedInstallationOctokit({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    permissions: { actions: "write" },
    operation,
  });
}

export function clampPerPage(value: string | null, fallback = 30): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 1), 100);
}
