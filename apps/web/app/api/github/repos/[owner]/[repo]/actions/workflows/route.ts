import "server-only";

import { listWorkflows } from "@/lib/github/actions-manager/workflows";
import {
  handleActionsRouteError,
  requireActionsReadAccess,
  withActionsWorkflowReadOctokit,
  type ActionsRouteContext,
} from "../_lib";

export async function GET(_request: Request, context: ActionsRouteContext) {
  const accessResult = await requireActionsReadAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const startMs = Date.now();

  try {
    const result = await withActionsWorkflowReadOctokit(access, (octokit) =>
      listWorkflows(octokit, access.owner, access.repo, access.defaultBranch),
    );
    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.workflows.listed",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        workflowCount: result.workflows.length,
        durationMs: Date.now() - startMs,
        redactionStatus: "not_required",
      }),
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return handleActionsRouteError(error);
  }
}
