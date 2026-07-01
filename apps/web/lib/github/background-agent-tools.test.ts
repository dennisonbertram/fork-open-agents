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

// Fake octokit surface used by withScopedInstallationOctokit's mock —
// individual test describe blocks overwrite the methods they need.
const fakeOctokit = {
  rest: {
    issues: {
      createComment: async (_params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }) => ({ data: { id: 555, html_url: "https://github.com/comment/555" } }),
    },
  },
};

let withScopedInstallationOctokitCallCount = 0;

function resetCapturedMintArgs() {
  capturedMintArgs = null;
  withScopedInstallationOctokitCallCount = 0;
}

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit: async (params: {
    installationId: number;
    repositoryIds: number[];
    permissions: Record<string, string>;
    operation: (octokit: unknown) => Promise<unknown>;
  }) => {
    withScopedInstallationOctokitCallCount += 1;
    capturedMintArgs = {
      installationId: params.installationId,
      repositoryIds: params.repositoryIds,
      permissions: params.permissions,
    };
    return params.operation(fakeOctokit);
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

  test("returns tools only for actions with an implemented tool builder (forward-compatible for unimplemented actions)", () => {
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

    // Only comment_on_pr_or_issue is implemented as of STEP-4; the rest
    // remain absent until their STEP-5..8 tool builders ship.
    expect(Object.keys(tools)).toEqual(["github_comment_on_pr_or_issue"]);
  });
});

describe("github_comment_on_pr_or_issue tool", () => {
  test("is absent from the tool set when comment_on_pr_or_issue is not enabled", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({ enabledActions: [] }),
    );

    expect(tools.github_comment_on_pr_or_issue).toBeUndefined();
  });

  test("posts a comment via issues.createComment scoped to issues:write and the full write-scope repositoryIds", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({
      repositoryIds: [11, 22, 33],
      repoOwner: "acme",
      repoName: "my-repo",
      enabledActions: ["comment_on_pr_or_issue"],
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const commentTool = tools.github_comment_on_pr_or_issue;
    expect(commentTool).toBeDefined();

    // biome-ignore lint: test-only cast into the AI SDK tool's execute fn
    const execute = (commentTool as any).execute as (
      input: { number: number; body: string },
      options: unknown,
    ) => Promise<unknown>;

    const result = await execute({ number: 12, body: "hi" }, {});

    expect(result).toEqual({
      ok: true,
      commentId: 555,
      url: "https://github.com/comment/555",
    });
    expect(capturedMintArgs).toEqual({
      installationId: ctx.installationId,
      repositoryIds: [11, 22, 33],
      permissions: { issues: "write" },
    });
    // Per-call mint-and-revoke: exactly one withScopedInstallationOctokit
    // call (its real implementation mints once and revokes once in a
    // finally, see app.ts) for this single tool invocation.
    expect(withScopedInstallationOctokitCallCount).toBe(1);
  });

  test("records a background-agent.github.comment_on_pr_or_issue event with minimal attribution on success", async () => {
    resetCapturedMintArgs();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["comment_on_pr_or_issue"],
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    // biome-ignore lint: test-only cast into the AI SDK tool's execute fn
    const execute = (tools.github_comment_on_pr_or_issue as any)
      .execute as (
      input: { number: number; body: string },
      options: unknown,
    ) => Promise<unknown>;

    await execute({ number: 12, body: "hi" }, {});

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.eventName).toBe(
      "background-agent.github.comment_on_pr_or_issue",
    );
    expect(recorded[0]?.status).toBe("succeeded");
    expect(recorded[0]?.payload?.number).toBe(12);
    expect(recorded[0]?.payload?.commentId).toBe(555);
  });

  test("returns a typed access_error result and records a failed event when the API call throws", async () => {
    resetCapturedMintArgs();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["comment_on_pr_or_issue"],
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const originalCreateComment = fakeOctokit.rest.issues.createComment;
    fakeOctokit.rest.issues.createComment = async () => {
      throw new Error("boom: not found");
    };

    try {
      const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
      // biome-ignore lint: test-only cast into the AI SDK tool's execute fn
      const execute = (tools.github_comment_on_pr_or_issue as any)
        .execute as (
        input: { number: number; body: string },
        options: unknown,
      ) => Promise<unknown>;

      const result = await execute({ number: 12, body: "hi" }, {});

      expect(result).toEqual({
        ok: false,
        errorKind: "access_error",
        error: "boom: not found",
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.status).toBe("failed");
    } finally {
      fakeOctokit.rest.issues.createComment = originalCreateComment;
    }
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
