import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-agents/sandbox";
import type { BackgroundAgentGitHubEventInput } from "./background-agent-tools";

mock.module("server-only", () => ({}));

// Captures the args withPerCallInstallationOctokit forwards to the real
// per-call mint/revoke wrapper (app.ts) — used by the bounded-scope
// regression test below.
let capturedMintArgs: {
  installationId: number;
  repositoryIds: number[];
  permissions: Record<string, string>;
} | null = null;

function resetCapturedMintArgs() {
  capturedMintArgs = null;
}

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit: async (params: {
    installationId: number;
    repositoryIds: number[];
    permissions: Record<string, string>;
    operation: (octokit: unknown) => Promise<unknown>;
  }) => {
    capturedMintArgs = {
      installationId: params.installationId,
      repositoryIds: params.repositoryIds,
      permissions: params.permissions,
    };
    return params.operation({ fake: "octokit" });
  },
}));

const {
  resolveGitHubActionToolsForBackgroundAgent,
  withPerCallInstallationOctokit,
  recordActionEvent,
} = await import("./background-agent-tools");

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

describe("withPerCallInstallationOctokit", () => {
  test("mints a token scoped to the full write-scope repositoryIds list, not just the home repo", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({ repositoryIds: [11, 22, 33] });

    const result = await withPerCallInstallationOctokit(
      ctx,
      { issues: "write" },
      async () => "operation-result",
    );

    expect(result).toBe("operation-result");
    // Regression guard: a future edit that narrows this to
    // [ctx.repositoryId] (home repo only) would silently break multi-repo
    // write scope (#736) for every background-agent GitHub action tool.
    expect(capturedMintArgs).toEqual({
      installationId: ctx.installationId,
      repositoryIds: [11, 22, 33],
      permissions: { issues: "write" },
    });
  });
});

describe("recordActionEvent", () => {
  test("tags destructive actions with high severity and low-risk actions with low severity", async () => {
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    await recordActionEvent(ctx, "merge_pull_request", "succeeded", {
      prNumber: 7,
    });
    await recordActionEvent(ctx, "comment_on_pr_or_issue", "succeeded", {
      number: 7,
    });

    expect(recorded[0]?.eventName).toBe(
      "background-agent.github.merge_pull_request",
    );
    expect(recorded[0]?.payload?.severity).toBe("high");
    expect(recorded[1]?.eventName).toBe(
      "background-agent.github.comment_on_pr_or_issue",
    );
    expect(recorded[1]?.payload?.severity).toBe("low");
  });
});
