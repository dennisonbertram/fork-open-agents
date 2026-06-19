import "server-only";

import { z } from "zod";
import {
  dispatchWorkflow,
  pollForDispatchedRun,
} from "@/lib/github/actions-manager/dispatch";
import { emitActionsMutationEvent } from "@/lib/github/actions-manager/events";
import {
  handleActionsWriteRouteError,
  requireActionsWriteAccess,
  withActionsWriteOctokit,
} from "../../../_lib";

const dispatchBodySchema = z.object({
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
});

type RouteContext = {
  params: Promise<{ owner: string; repo: string; workflowId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const accessResult = await requireActionsWriteAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const { access } = accessResult;
  const { workflowId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, errorKind: "invalid_repo", error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = dispatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        errorKind: "invalid_repo",
        error: "ref is required and must be a non-empty string",
      },
      { status: 400 },
    );
  }

  const { ref, inputs } = parsed.data;
  const startMs = Date.now();

  try {
    const since = new Date();
    let newRunId: number | null = null;

    await withActionsWriteOctokit(access, async (octokit) => {
      await dispatchWorkflow(
        octokit,
        access.owner,
        access.repo,
        workflowId,
        ref,
        inputs,
      );
      newRunId = await pollForDispatchedRun(
        octokit,
        access.owner,
        access.repo,
        workflowId,
        ref,
        since,
      );
    });

    console.log(
      JSON.stringify({
        service: "github-actions-manager",
        event: "actions.workflow.dispatch",
        level: "info",
        userId: access.userId,
        installationId: access.installationId,
        repoId: access.repositoryId,
        requestId: access.requestId,
        workflowId,
        ref,
        newRunId,
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
      action: "workflow.dispatch",
      workflowId,
      runId: newRunId ?? undefined,
      dispatchRef: ref,
    });

    return Response.json({ ok: true, newRunId });
  } catch (error) {
    return handleActionsWriteRouteError(error);
  }
}
