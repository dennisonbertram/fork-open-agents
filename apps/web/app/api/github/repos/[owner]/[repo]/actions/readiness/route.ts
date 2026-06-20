import "server-only";

import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { verifyRepoAccess } from "@/lib/github/access";
import { getActionsManagerReadinessCheck } from "@/lib/github/actions-manager/readiness";
import type { ActionsRouteContext } from "../_lib";

export async function GET(request: Request, context: ActionsRouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { owner, repo } = await context.params;
  const access = await verifyRepoAccess({
    userId: authResult.userId,
    owner,
    repo,
    requiredUserPermission: "read",
  });

  if (!access.ok) {
    return Response.json(
      {
        ok: false,
        errorKind:
          access.reason === "no_installation"
            ? "installation_missing"
            : "repo_access_denied",
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const requiredPermission =
    url.searchParams.get("permission") === "write" ? "write" : "read";
  const readiness = await getActionsManagerReadinessCheck({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    requiredPermission,
  });

  return Response.json({
    ok: true,
    readiness,
    defaultBranch: access.defaultBranch,
  });
}
