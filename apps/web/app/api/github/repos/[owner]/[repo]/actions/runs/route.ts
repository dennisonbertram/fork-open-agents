import "server-only";

import { listWorkflowRuns } from "@/lib/github/actions-manager/runs";
import {
  clampPerPage,
  handleActionsRouteError,
  requireActionsReadAccess,
  withActionsReadOctokit,
  type ActionsRouteContext,
} from "../_lib";

export async function GET(request: Request, context: ActionsRouteContext) {
  const accessResult = await requireActionsReadAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const url = new URL(request.url);
  const filters = {
    branch: url.searchParams.get("branch") ?? undefined,
    event: url.searchParams.get("event") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    perPage: clampPerPage(url.searchParams.get("per_page"), 30),
  };
  const startMs = Date.now();

  try {
    const result = await withActionsReadOctokit(access, (octokit) =>
      listWorkflowRuns(octokit, access.owner, access.repo, filters),
    );
    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.runs.listed",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        runCount: result.runs.length,
        durationMs: Date.now() - startMs,
        redactionStatus: "not_required",
      }),
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return handleActionsRouteError(error);
  }
}
