import type { Octokit } from "@octokit/rest";
import { getWorkflowRunDisplay, type WorkflowRunDisplay } from "./runs";

export type WorkflowJobStep = {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type WorkflowJobItem = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string;
  display: WorkflowRunDisplay;
  steps: WorkflowJobStep[];
};

type GitHubWorkflowJob = {
  id: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
  steps?: Array<{
    name?: string | null;
    status?: string | null;
    conclusion?: string | null;
    number?: number;
    started_at?: string | null;
    completed_at?: string | null;
  }>;
};

export async function listRunJobs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<{ totalCount: number; jobs: WorkflowJobItem[] }> {
  const response = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });
  const data = response.data as {
    total_count?: number;
    jobs?: GitHubWorkflowJob[];
  };

  return {
    totalCount: data.total_count ?? data.jobs?.length ?? 0,
    jobs: (data.jobs ?? []).map((job) => {
      const status = job.status ?? "unknown";
      const conclusion = job.conclusion ?? null;
      return {
        id: job.id,
        name: job.name ?? "Job",
        status,
        conclusion,
        startedAt: job.started_at ?? null,
        completedAt: job.completed_at ?? null,
        htmlUrl: job.html_url ?? "",
        display: getWorkflowRunDisplay(status, conclusion),
        steps: (job.steps ?? []).map((step) => ({
          name: step.name ?? "Step",
          status: step.status ?? "unknown",
          conclusion: step.conclusion ?? null,
          number: step.number ?? 0,
          startedAt: step.started_at ?? null,
          completedAt: step.completed_at ?? null,
        })),
      };
    }),
  };
}
