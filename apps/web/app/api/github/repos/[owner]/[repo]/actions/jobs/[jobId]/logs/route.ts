import "server-only";

import { proxyJobLogs } from "@/lib/github/actions-manager/logs";
import {
  handleActionsRouteError,
  requireActionsReadAccess,
  withActionsReadOctokit,
} from "../../../_lib";

type RouteContext = {
  params: Promise<{ owner: string; repo: string; jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const accessResult = await requireActionsReadAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const { jobId: jobIdRaw } = await context.params;
  const jobId = Number.parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    return Response.json(
      { ok: false, errorKind: "invalid_repo", error: "Invalid job id" },
      { status: 400 },
    );
  }
  const startMs = Date.now();

  try {
    const logs = await withActionsReadOctokit(access, (octokit) =>
      proxyJobLogs(octokit, access.owner, access.repo, jobId),
    );
    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.logs.proxied",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        jobId,
        bytes: logs.bytes,
        durationMs: Date.now() - startMs,
      }),
    );
    return new Response(logs.text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleActionsRouteError(error);
  }
}
