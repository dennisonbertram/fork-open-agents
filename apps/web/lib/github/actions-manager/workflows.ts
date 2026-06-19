import type { Octokit } from "@octokit/rest";

export type WorkflowItem = {
  id: number;
  name: string;
  path: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
};

type GitHubWorkflow = {
  id: number;
  name?: string | null;
  path?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
};

export async function listWorkflows(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ totalCount: number; workflows: WorkflowItem[] }> {
  const response = await octokit.rest.actions.listRepoWorkflows({
    owner,
    repo,
    per_page: 100,
  });
  const data = response.data as {
    total_count?: number;
    workflows?: GitHubWorkflow[];
  };

  return {
    totalCount: data.total_count ?? data.workflows?.length ?? 0,
    workflows: (data.workflows ?? []).map((workflow) => ({
      id: workflow.id,
      name: workflow.name ?? "Workflow",
      path: workflow.path ?? "",
      state: workflow.state ?? "unknown",
      createdAt: workflow.created_at ?? "",
      updatedAt: workflow.updated_at ?? "",
      htmlUrl: workflow.html_url ?? "",
    })),
  };
}
