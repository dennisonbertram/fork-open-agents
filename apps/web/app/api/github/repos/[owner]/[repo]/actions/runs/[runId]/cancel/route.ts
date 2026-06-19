import "server-only";

import { emitActionsManagerEvent } from "@/lib/github/actions-manager/events";
import { cancelRun } from "@/lib/github/actions-manager/runs";
import {
  handleActionsMutationRouteError,
  jsonError,
  requireActionsWriteAccess,
  withActionsWriteOctokit,
} from "../../../_lib";

type ActionsRunMutationContext = {
  params: Promise<{ owner: string; repo: string; runId: string }>;
};

function parseRunId(value: string): number | null {
  const runId = Number(value);
  return Number.isSafeInteger(runId) && runId > 0 ? runId : null;
}

export async function POST(
  _request: Request,
  context: ActionsRunMutationContext,
) {
  const accessResult = await requireActionsWriteAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const { runId: runIdParam } = await context.params;
  const runId = parseRunId(runIdParam);
  if (runId === null) {
    return jsonError("github_error", 400);
  }

  try {
    await withActionsWriteOctokit(access, (octokit) =>
      cancelRun(octokit, access.owner, access.repo, runId),
    );
    await emitActionsManagerEvent({
      action: "run.cancel",
      userId: access.userId,
      requestId: access.requestId,
      installationId: access.installationId,
      repoId: access.repositoryId,
      repoOwner: access.owner,
      repoName: access.repo,
      runId,
      redactionStatus: "not_required",
    });

    return Response.json(
      { ok: true, action: "run.cancel", runId },
      { status: 202 },
    );
  } catch (error) {
    return handleActionsMutationRouteError(error);
  }
}
