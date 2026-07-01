import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

const { resolveGitHubActionToolsForBackgroundAgent } = await import(
  "./background-agent-tools"
);

type Ctx = Parameters<typeof resolveGitHubActionToolsForBackgroundAgent>[0];

function buildCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    installationId: 42,
    repositoryIds: [99],
    repoOwner: "acme",
    repoName: "my-repo",
    baseBranch: "main",
    userId: "user-1",
    agentName: "Review Agent",
    runId: "run-1",
    agentId: "agent-1",
    workflowRunId: "workflow-1",
    requestId: "req-1",
    sandboxName: "sandbox-1",
    triggerKind: "schedule.cron",
    checkCommand: null,
    sandbox: {} as unknown as Sandbox,
    enabledActions: [],
    requireCiGreenToMerge: true,
    recordEvent: async () => {
      // no-op
    },
    recordOutput: async () => {
      // no-op
    },
    ...overrides,
  };
}

describe("resolveGitHubActionToolsForBackgroundAgent", () => {
  test("returns an empty tool set when enabledActions is empty", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(buildCtx());

    expect(Object.keys(tools)).toEqual([]);
  });

  test("returns an empty tool set for actions that have no implemented tool builder yet (forward-compatible)", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({
        enabledActions: [
          "open_pull_request",
          "comment_on_pr_or_issue",
          "approve_pull_request",
          "request_changes",
          "merge_pull_request",
          "push",
          "delete_branch",
        ],
      }),
    );

    expect(Object.keys(tools)).toEqual([]);
  });
});
