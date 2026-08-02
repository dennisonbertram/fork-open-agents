import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getBackgroundAgentRepoReadiness } from "@/lib/background-agents/repo-readiness";
import { getBackgroundAgentReadinessWithGitHubAppMetadata } from "@/lib/background-agents/readiness";
import type { RequiredRepoUserPermission } from "@/lib/github/access";

function parsePermission(value: string | null): RequiredRepoUserPermission {
  return value === "read" ? "read" : "write";
}

function parseRepoParams(request: Request | undefined) {
  if (!request) {
    return null;
  }

  const url = new URL(request.url);
  const repoOwner = url.searchParams.get("repoOwner")?.trim();
  const repoName = url.searchParams.get("repoName")?.trim();
  if (!(repoOwner || repoName)) {
    return null;
  }
  if (!(repoOwner && repoName)) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "repoOwner and repoName are both required",
          errorKind: "invalid_request",
        },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true as const,
    repoOwner,
    repoName,
    requiredUserPermission: parsePermission(url.searchParams.get("permission")),
  };
}

export async function GET(request?: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const readiness = await getBackgroundAgentReadinessWithGitHubAppMetadata();
  const repoParams = parseRepoParams(request);
  if (!repoParams) {
    return Response.json(readiness);
  }
  if (!repoParams.ok) {
    return repoParams.response;
  }

  const repoAccess = await getBackgroundAgentRepoReadiness({
    userId: authResult.userId,
    repoOwner: repoParams.repoOwner,
    repoName: repoParams.repoName,
    requiredUserPermission: repoParams.requiredUserPermission,
  });

  return Response.json({
    ...readiness,
    repoAccess,
  });
}
