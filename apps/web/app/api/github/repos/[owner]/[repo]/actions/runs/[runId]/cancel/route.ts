import "server-only";

import { cancelWorkflowRun } from "@/lib/github/actions-manager/runs";
import { emitActionsMutationEvent } from "@/lib/github/actions-manager/events";
import {
  handleActionsWriteRouteError,
  requireActionsWriteAccess,
  withActionsWriteOctokit,
} from "../../../_lib";

type RouteContext = {
  params: Promise<{ owner: string; repo: string; runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const accessResult = await requireActionsWriteAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const { runId: runIdRaw } = await context.params;
  const runId = Number.parseInt(runIdRaw, 10);
  if (!Number.isFinite(runId)) {
    return Response.json(
      { ok: false, errorKind: "invalid_repo", error: "Invalid run id" },
      { status: 400 },
    );
  }

  const startMs = Date.now();

  try {
    await withActionsWriteOctokit(access, (octokit) =>
      cancelWorkflowRun(octokit, access.owner, access.repo, runId),
    );

    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.run.cancel",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        runId,
        durationMs: Date.now() - startMs,
        redactionStatus: "not_required",
      }),
    );

    await emitActionsMutationEvent({
      userId: access.userId,
      installationId: access.installationId,
      repoId: access.repositoryId,
      repoOwner: access.owner,
      repoName: access.repo,
      action: "run.cancel",
      runId,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return handleActionsWriteRouteError(error);
  }
}
