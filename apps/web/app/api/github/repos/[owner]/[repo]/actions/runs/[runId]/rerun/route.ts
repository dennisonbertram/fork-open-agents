import "server-only";

import { emitActionsManagerEvent } from "@/lib/github/actions-manager/events";
import { rerunFailedJobs, rerunRun } from "@/lib/github/actions-manager/runs";
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
  request: Request,
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

  const url = new URL(request.url);
  const onlyFailed = url.searchParams.get("onlyFailed") === "true";
  const action = onlyFailed ? "run.rerun_failed" : "run.rerun";

  try {
    await withActionsWriteOctokit(access, (octokit) =>
      onlyFailed
        ? rerunFailedJobs(octokit, access.owner, access.repo, runId)
        : rerunRun(octokit, access.owner, access.repo, runId),
    );
    await emitActionsManagerEvent({
      action,
      userId: access.userId,
      requestId: access.requestId,
      installationId: access.installationId,
      repoId: access.repositoryId,
      repoOwner: access.owner,
      repoName: access.repo,
      runId,
      redactionStatus: "not_required",
    });

    return Response.json({ ok: true, action, runId }, { status: 202 });
  } catch (error) {
    return handleActionsMutationRouteError(error);
  }
}
