import "server-only";

import {
  dispatchWorkflow,
  pollForDispatchedRun,
} from "@/lib/github/actions-manager/dispatch";
import { emitActionsManagerEvent } from "@/lib/github/actions-manager/events";
import {
  handleActionsMutationRouteError,
  jsonError,
  requireActionsWriteAccess,
  withActionsWriteOctokit,
} from "../../../_lib";

type ActionsWorkflowDispatchContext = {
  params: Promise<{ owner: string; repo: string; workflowId: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseBody(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.ref !== "string") {
      return {
        ok: false as const,
        errorKind: "dispatch_input_invalid" as const,
      };
    }

    const inputs = isRecord(body.inputs)
      ? Object.fromEntries(
          Object.entries(body.inputs).map(([key, value]) => [
            key,
            typeof value === "string" ? value : String(value),
          ]),
        )
      : undefined;

    return { ok: true as const, ref: body.ref, inputs };
  } catch {
    return {
      ok: false as const,
      errorKind: "dispatch_input_invalid" as const,
    };
  }
}

export async function POST(
  request: Request,
  context: ActionsWorkflowDispatchContext,
) {
  const accessResult = await requireActionsWriteAccess(context);
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const parsedBody = await parseBody(request);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.errorKind);
  }

  const { access } = accessResult;
  if (parsedBody.ref !== access.defaultBranch) {
    return jsonError("workflow_not_on_default_branch");
  }

  const { workflowId } = await context.params;
  const dispatchedAt = new Date();

  try {
    const run = await withActionsWriteOctokit(access, async (octokit) => {
      await dispatchWorkflow(octokit, {
        owner: access.owner,
        repo: access.repo,
        workflowId,
        ref: parsedBody.ref,
        defaultBranch: access.defaultBranch,
        inputs: parsedBody.inputs,
      });

      return pollForDispatchedRun(octokit, {
        owner: access.owner,
        repo: access.repo,
        workflowId,
        since: dispatchedAt,
      });
    });

    await emitActionsManagerEvent({
      action: "workflow.dispatch",
      userId: access.userId,
      requestId: access.requestId,
      installationId: access.installationId,
      repoId: access.repositoryId,
      repoOwner: access.owner,
      repoName: access.repo,
      workflowId,
      dispatchRef: parsedBody.ref,
      inputKeys: Object.keys(parsedBody.inputs ?? {}),
      inputs: parsedBody.inputs,
      redactionStatus: parsedBody.inputs ? "passed" : "not_required",
    });

    return Response.json(
      { ok: true, action: "workflow.dispatch", run },
      { status: 202 },
    );
  } catch (error) {
    return handleActionsMutationRouteError(error);
  }
}
