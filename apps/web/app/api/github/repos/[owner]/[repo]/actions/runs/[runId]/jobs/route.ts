import "server-only";

import { listRunJobs } from "@/lib/github/actions-manager/jobs";
import {
  handleActionsRouteError,
  requireActionsReadAccess,
  withActionsReadOctokit,
} from "../../../_lib";

type RouteContext = {
  params: Promise<{ owner: string; repo: string; runId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const accessResult = await requireActionsReadAccess(context);
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
    const result = await withActionsReadOctokit(access, (octokit) =>
      listRunJobs(octokit, access.owner, access.repo, runId),
    );
    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.jobs.listed",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        runId,
        jobCount: result.jobs.length,
        durationMs: Date.now() - startMs,
      }),
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return handleActionsRouteError(error);
  }
}
