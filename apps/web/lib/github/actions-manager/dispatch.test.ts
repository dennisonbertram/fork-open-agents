import { describe, expect, mock, test } from "bun:test";
import type { Octokit } from "@octokit/rest";

import {
  dispatchWorkflow,
  pollForDispatchedRun,
  validateWorkflowDispatchRequest,
} from "./dispatch";

function createOctokit(
  runs: Array<{
    id: number;
    run_number?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    head_branch?: string;
    event?: string;
    created_at?: string;
    updated_at?: string;
    html_url?: string;
  }> = [],
) {
  return {
    request: mock(async (endpoint: string) => {
      if (endpoint.startsWith("GET ")) {
        return { data: { total_count: runs.length, workflow_runs: runs } };
      }
      return { status: 204, data: "" };
    }),
    rest: {
      actions: {
        createWorkflowDispatch: mock(async () => ({ status: 204, data: "" })),
        listWorkflowRuns: mock(async () => ({
          data: { total_count: runs.length, workflow_runs: runs },
        })),
      },
    },
  } as unknown as Octokit;
}

describe("actions-manager workflow dispatch", () => {
  test("rejects dispatch when ref does not match the default branch", async () => {
    const octokit = createOctokit();

    await expect(
      dispatchWorkflow(octokit, {
        owner: "acme",
        repo: "widgets",
        workflowId: "ci.yml",
        ref: "feature",
        defaultBranch: "develop",
      }),
    ).rejects.toMatchObject({
      errorKind: "workflow_not_on_default_branch",
    });

    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  test("validates GitHub workflow_dispatch input limits", () => {
    const tooManyInputs = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [`input-${index}`, "value"]),
    );
    const hugeInput = { notes: "x".repeat(65_536) };

    expect(validateWorkflowDispatchRequest({ ref: "develop" }).ok).toBe(true);
    expect(
      validateWorkflowDispatchRequest({
        ref: "develop",
        inputs: tooManyInputs,
      }),
    ).toMatchObject({ ok: false, errorKind: "dispatch_input_invalid" });
    expect(
      validateWorkflowDispatchRequest({ ref: "develop", inputs: hugeInput }),
    ).toMatchObject({ ok: false, errorKind: "dispatch_input_invalid" });
  });

  test("polls for a workflow_dispatch run created after the dispatch timestamp", async () => {
    const octokit = createOctokit([
      {
        id: 100,
        run_number: 12,
        name: "CI",
        status: "queued",
        conclusion: null,
        head_branch: "develop",
        event: "workflow_dispatch",
        created_at: "2026-06-19T14:00:02Z",
        updated_at: "2026-06-19T14:00:02Z",
        html_url: "https://github.com/acme/widgets/actions/runs/100",
      },
      {
        id: 99,
        run_number: 11,
        name: "CI",
        status: "completed",
        conclusion: "success",
        head_branch: "develop",
        event: "workflow_dispatch",
        created_at: "2026-06-19T13:59:00Z",
        updated_at: "2026-06-19T13:59:10Z",
        html_url: "https://github.com/acme/widgets/actions/runs/99",
      },
    ]);

    const run = await pollForDispatchedRun(octokit, {
      owner: "acme",
      repo: "widgets",
      workflowId: "ci.yml",
      since: new Date("2026-06-19T14:00:00Z"),
      timeoutMs: 1,
      intervalMs: 1,
    });

    expect(run).toMatchObject({
      id: 100,
      runNumber: 12,
      event: "workflow_dispatch",
    });
  });

  test("returns undefined when the dispatched run does not appear before timeout", async () => {
    const octokit = createOctokit([]);

    const run = await pollForDispatchedRun(octokit, {
      owner: "acme",
      repo: "widgets",
      workflowId: "ci.yml",
      since: new Date("2026-06-19T14:00:00Z"),
      timeoutMs: 1,
      intervalMs: 1,
    });

    expect(run).toBeUndefined();
  });
});
