import type { Octokit } from "@octokit/rest";

export type DispatchInputs = Record<string, string>;

export async function dispatchWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string,
  inputs: DispatchInputs = {},
): Promise<{ ok: true }> {
  await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId as unknown as number,
    ref,
    inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
  });
  return { ok: true };
}

export async function pollForDispatchedRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string,
  since: Date,
  maxWaitMs = 20000,
): Promise<number | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const response = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      workflow_id: workflowId as unknown as number,
      branch: ref,
      per_page: 5,
    });
    const data = response.data as {
      workflow_runs?: Array<{ id: number; created_at: string }>;
    };
    const runs = data.workflow_runs ?? [];
    for (const run of runs) {
      if (run.created_at && new Date(run.created_at) > since) {
        return run.id;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}
