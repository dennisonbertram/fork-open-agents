import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { getWorkflowRunDisplay, type WorkflowRunItem } from "./runs";

export type WorkflowDispatchInput = {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  defaultBranch: string;
  inputs?: Record<string, string>;
};

export type WorkflowDispatchRequest =
  | { ok: true; ref: string; inputs?: Record<string, string> }
  | { ok: false; errorKind: "dispatch_input_invalid" };

type GitHubWorkflowRun = {
  id: number;
  run_number?: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  event?: string | null;
  actor?: { login?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
};

const dispatchBodySchema = z.object({
  ref: z.string().trim().min(1).max(255),
  inputs: z
    .record(z.string().min(1).max(255), z.string().max(65_535))
    .refine((inputs) => Object.keys(inputs).length <= 25, {
      message: "GitHub accepts at most 25 workflow_dispatch inputs.",
    })
    .optional(),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createActionsError(
  errorKind: "workflow_not_on_default_branch" | "dispatch_input_invalid",
) {
  return Object.assign(new Error(errorKind), { errorKind });
}

function normalizeWorkflowId(workflowId: string): string | number {
  const numericId = Number(workflowId);
  return Number.isSafeInteger(numericId) && numericId > 0
    ? numericId
    : workflowId;
}

function mapWorkflowRun(run: GitHubWorkflowRun): WorkflowRunItem {
  const status = run.status ?? "unknown";
  const conclusion = run.conclusion ?? null;

  return {
    id: run.id,
    runNumber: run.run_number ?? run.id,
    name: run.name ?? "Workflow",
    status,
    conclusion,
    branch: run.head_branch ?? "unknown",
    event: run.event ?? "unknown",
    actor: run.actor?.login ?? null,
    createdAt: run.created_at ?? "",
    updatedAt: run.updated_at ?? run.created_at ?? "",
    htmlUrl: run.html_url ?? "",
    durationMs: null,
    display: getWorkflowRunDisplay(status, conclusion),
  };
}

export function validateWorkflowDispatchRequest(
  body: unknown,
): WorkflowDispatchRequest {
  const parsed = dispatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errorKind: "dispatch_input_invalid" };
  }

  return {
    ok: true,
    ref: parsed.data.ref,
    inputs: parsed.data.inputs,
  };
}

export async function dispatchWorkflow(
  octokit: Octokit,
  params: WorkflowDispatchInput,
): Promise<void> {
  const validation = validateWorkflowDispatchRequest({
    ref: params.ref,
    inputs: params.inputs,
  });
  if (!validation.ok) {
    throw createActionsError(validation.errorKind);
  }

  if (validation.ref !== params.defaultBranch) {
    throw createActionsError("workflow_not_on_default_branch");
  }

  await octokit.request(
    "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
    {
      owner: params.owner,
      repo: params.repo,
      workflow_id: normalizeWorkflowId(params.workflowId),
      ref: validation.ref,
      inputs: validation.inputs,
    },
  );
}

export async function pollForDispatchedRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    workflowId: string;
    since: Date;
    timeoutMs?: number;
    intervalMs?: number;
  },
): Promise<WorkflowRunItem | undefined> {
  const timeoutMs = params.timeoutMs ?? 20_000;
  const intervalMs = params.intervalMs ?? 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
      {
        owner: params.owner,
        repo: params.repo,
        workflow_id: normalizeWorkflowId(params.workflowId),
        event: "workflow_dispatch",
        per_page: 10,
      },
    );
    const data = response.data as { workflow_runs?: GitHubWorkflowRun[] };
    const match = (data.workflow_runs ?? [])
      .filter((run) => run.event === "workflow_dispatch")
      .filter((run) => {
        const createdAt = Date.parse(run.created_at ?? "");
        return (
          Number.isFinite(createdAt) && createdAt >= params.since.getTime()
        );
      })
      .sort((a, b) => {
        const aCreated = Date.parse(a.created_at ?? "");
        const bCreated = Date.parse(b.created_at ?? "");
        return bCreated - aCreated;
      })[0];

    if (match) {
      return mapWorkflowRun(match);
    }

    if (Date.now() - startedAt + intervalMs > timeoutMs) {
      break;
    }
    await sleep(intervalMs);
  }

  return undefined;
}
