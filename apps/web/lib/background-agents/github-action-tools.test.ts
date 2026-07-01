/**
 * #744 — Native GitHub action tool module.
 *
 * Verifies the resolveGitHubActionTools(ctx) factory:
 *  - toggle filtering (factory excludes disabled actions)
 *  - write-scope refusal (this_repo/all_repos/specific_repos)
 *  - CI-green refusal on merge
 *  - default-branch delete refusal
 *  - audit events + output rows on success and failure
 *  - token minted/revoked per call
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared types (mirrors store.ts shapes)
// ---------------------------------------------------------------------------
type EventInput = {
  runId: string;
  agentId?: string | null;
  userId: string;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  payload?: unknown;
};

type OutputInput = {
  runId: string;
  userId: string;
  kind: string;
  status: string;
  url?: string | null;
  prNumber?: number | null;
  payload?: unknown;
};

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------
const recordBackgroundAgentEvent = mock(async (input: EventInput) => input);
const recordBackgroundAgentOutput = mock(async (input: OutputInput) => input);

mock.module("./store", () => ({
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
}));

// ---------------------------------------------------------------------------
// GitHub access mocks
// ---------------------------------------------------------------------------
type AccessResult =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      userPermission: "read" | "write";
    }
  | { ok: false; reason: string };

let mockAccessResult: AccessResult = {
  ok: true,
  installationId: 42,
  repositoryId: 99,
  defaultBranch: "main",
  userPermission: "write",
};

const verifyRepoAccess = mock(async (_params: unknown) => mockAccessResult);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess,
}));

// ---------------------------------------------------------------------------
// GitHub app (token mint/revoke) mocks
// ---------------------------------------------------------------------------
let mintTokenCalls: Array<{
  installationId: number;
  repositoryIds: number[];
  permissions: Record<string, string>;
}> = [];
let revokeTokenCalls: string[] = [];
let mintTokenShouldFail = false;
let tokenCounter = 0;

const mintInstallationToken = mock(
  async (params: {
    installationId: number;
    repositoryIds: number[];
    permissions: Record<string, string>;
  }) => {
    if (mintTokenShouldFail) {
      throw new Error("Failed to mint GitHub installation token: 401 bad");
    }
    mintTokenCalls.push(params);
    tokenCounter += 1;
    return {
      token: `scoped-token-${tokenCounter}`,
      expiresAt: null,
      installationId: params.installationId,
      repositoryIds: params.repositoryIds,
      permissions: params.permissions,
    };
  },
);

const revokeInstallationToken = mock(async (token: string) => {
  revokeTokenCalls.push(token);
});

type ScopedOctokitCall = {
  installationId: number;
  repositoryId: number;
  permissions: Record<string, string>;
};
let scopedOctokitCalls: ScopedOctokitCall[] = [];
let mockOctokit: Record<string, unknown> = {};

const withScopedInstallationOctokit = mock(
  async (params: {
    installationId: number;
    repositoryId: number;
    permissions: Record<string, string>;
    operation: (octokit: unknown) => Promise<unknown>;
  }) => {
    scopedOctokitCalls.push({
      installationId: params.installationId,
      repositoryId: params.repositoryId,
      permissions: params.permissions,
    });
    // Mirror withScopedInstallationOctokit's real mint/revoke behavior so
    // token-per-call assertions are meaningful.
    if (mintTokenShouldFail) {
      throw new Error("Failed to mint GitHub installation token: 401 bad");
    }
    const token = await mintInstallationToken({
      installationId: params.installationId,
      repositoryIds: [params.repositoryId],
      permissions: params.permissions,
    });
    try {
      return await params.operation(mockOctokit);
    } finally {
      await revokeInstallationToken(token.token);
    }
  },
);

mock.module("@/lib/github/app", () => ({
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
}));

// ---------------------------------------------------------------------------
// GitHub pulls mocks
// ---------------------------------------------------------------------------
let openPullRequestResult: {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  nodeId?: string;
  error?: string;
} = {
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/42",
  prNumber: 42,
  nodeId: "node-1",
};
const openPullRequest = mock(async (_params: unknown) => openPullRequestResult);

let mergePullRequestResult: {
  success: boolean;
  sha?: string;
  error?: string;
  statusCode?: number;
} = { success: true, sha: "merged-sha" };
const mergePullRequest = mock(
  async (_params: unknown) => mergePullRequestResult,
);

let deleteBranchRefResult: {
  success: boolean;
  error?: string;
  statusCode?: number;
} = { success: true };
const deleteBranchRef = mock(async (_params: unknown) => deleteBranchRefResult);

let mergeReadinessResult: {
  success: boolean;
  canMerge: boolean;
  reasons: string[];
  allowedMethods: string[];
  defaultMethod: string;
  checks: {
    requiredTotal: number;
    passed: number;
    pending: number;
    failed: number;
  };
} = {
  success: true,
  canMerge: true,
  reasons: [],
  allowedMethods: ["squash"],
  defaultMethod: "squash",
  checks: { requiredTotal: 1, passed: 1, pending: 0, failed: 0 },
};
const getMergeReadinessViaInstallation = mock(
  async (_params: unknown) => mergeReadinessResult,
);

let createReviewCapturedArgs: Record<string, unknown> | null = null;
let submitPullRequestReviewResult: {
  success: boolean;
  reviewId?: number;
  error?: string;
} = { success: true, reviewId: 555 };
const submitPullRequestReview = mock(
  async (params: Record<string, unknown>) => {
    createReviewCapturedArgs = params;
    return submitPullRequestReviewResult;
  },
);

mock.module("@/lib/github/pulls", () => ({
  openPullRequest,
  mergePullRequest,
  deleteBranchRef,
  getMergeReadinessViaInstallation,
  submitPullRequestReview,
}));

// ---------------------------------------------------------------------------
// Commit intent / commit mocks (github_push)
// ---------------------------------------------------------------------------
let buildCommitIntentResult:
  | {
      ok: true;
      intent: {
        owner: string;
        repo: string;
        repositoryId: number;
        installationId: number;
        branch: string;
        baseBranch?: string;
        expectedHeadSha: string;
        message: string;
        files: unknown[];
        coAuthor?: { name: string; email: string };
      };
    }
  | { ok: false; error: string; empty?: boolean } = {
  ok: true,
  intent: {
    owner: "acme",
    repo: "widgets",
    repositoryId: 99,
    installationId: 42,
    branch: "feature-branch",
    baseBranch: "main",
    expectedHeadSha: "base-sha",
    message: "chore: apply changes",
    files: [{ path: "a.ts", status: "modified" }],
  },
};
const buildCommitIntentFromSandbox = mock(
  async (_params: unknown) => buildCommitIntentResult,
);

let createCommitResult:
  | { ok: true; commitSha: string }
  | { ok: false; error: string } = {
  ok: true,
  commitSha: "new-commit-sha",
};
const createCommit = mock(async (_params: unknown) => createCommitResult);

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox,
}));
mock.module("@/lib/github/commit", () => ({
  createCommit,
}));

// ---------------------------------------------------------------------------
// Fake sandbox
// ---------------------------------------------------------------------------
const fakeSandbox = {
  workingDirectory: "/workspace/widgets",
  currentBranch: "feature-branch",
} as unknown as Sandbox;

// ---------------------------------------------------------------------------
// Module under test (imported after all mocks are wired)
// ---------------------------------------------------------------------------
const { resolveGitHubActionTools } = await import("./github-action-tools");
type ResolveGitHubActionToolsCtx = Parameters<
  typeof resolveGitHubActionTools
>[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildCtx(
  overrides: Partial<ResolveGitHubActionToolsCtx> = {},
): ResolveGitHubActionToolsCtx {
  return {
    runId: "run-1",
    agentId: "agent-1",
    userId: "user-1",
    workflowRunId: "workflow-1",
    installationId: 42,
    repositoryId: 99,
    repoOwner: "acme",
    repoName: "widgets",
    defaultBranch: "main",
    toggles: {
      openPullRequest: true,
      commentOnPrOrIssue: true,
      approvePullRequest: true,
      requestChanges: true,
      mergePullRequest: true,
      push: true,
      deleteBranch: true,
    },
    writeScope: { mode: "this_repo" },
    requireCiGreen: false,
    userPermission: "write",
    ...overrides,
  };
}

function recordedEvents() {
  return recordBackgroundAgentEvent.mock.calls.map(
    ([input]: [EventInput]) => input,
  );
}

function recordedEventNames() {
  return recordedEvents().map((event) => event.eventName);
}

type ToolExecutor = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

beforeEach(() => {
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  verifyRepoAccess.mockClear();
  mintInstallationToken.mockClear();
  revokeInstallationToken.mockClear();
  withScopedInstallationOctokit.mockClear();
  openPullRequest.mockClear();
  mergePullRequest.mockClear();
  deleteBranchRef.mockClear();
  getMergeReadinessViaInstallation.mockClear();
  submitPullRequestReview.mockClear();
  buildCommitIntentFromSandbox.mockClear();
  createCommit.mockClear();

  mintTokenCalls = [];
  revokeTokenCalls = [];
  scopedOctokitCalls = [];
  mintTokenShouldFail = false;
  tokenCounter = 0;
  createReviewCapturedArgs = null;
  mockOctokit = {};

  mockAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 99,
    defaultBranch: "main",
    userPermission: "write",
  };

  openPullRequestResult = {
    success: true,
    prUrl: "https://github.com/acme/widgets/pull/42",
    prNumber: 42,
    nodeId: "node-1",
  };
  mergePullRequestResult = { success: true, sha: "merged-sha" };
  deleteBranchRefResult = { success: true };
  mergeReadinessResult = {
    success: true,
    canMerge: true,
    reasons: [],
    allowedMethods: ["squash"],
    defaultMethod: "squash",
    checks: { requiredTotal: 1, passed: 1, pending: 0, failed: 0 },
  };
  submitPullRequestReviewResult = { success: true, reviewId: 555 };
  buildCommitIntentResult = {
    ok: true,
    intent: {
      owner: "acme",
      repo: "widgets",
      repositoryId: 99,
      installationId: 42,
      branch: "feature-branch",
      baseBranch: "main",
      expectedHeadSha: "base-sha",
      message: "chore: apply changes",
      files: [{ path: "a.ts", status: "modified" }],
    },
  };
  createCommitResult = { ok: true, commitSha: "new-commit-sha" };
});

afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// Factory / toggle filtering
// ---------------------------------------------------------------------------
describe("resolveGitHubActionTools — toggle filtering", () => {
  test("all toggles enabled → returns all seven tools", async () => {
    const tools = resolveGitHubActionTools(buildCtx());
    expect(Object.keys(tools).sort()).toEqual(
      [
        "github_open_pull_request",
        "github_comment_on_pr_or_issue",
        "github_approve_pull_request",
        "github_request_changes",
        "github_merge_pull_request",
        "github_push",
        "github_delete_branch",
      ].sort(),
    );
  });

  test("all toggles disabled → returns empty tool set", () => {
    const tools = resolveGitHubActionTools(
      buildCtx({
        toggles: {
          openPullRequest: false,
          commentOnPrOrIssue: false,
          approvePullRequest: false,
          requestChanges: false,
          mergePullRequest: false,
          push: false,
          deleteBranch: false,
        },
      }),
    );
    expect(Object.keys(tools)).toEqual([]);
  });

  test("only mergePullRequest enabled → returns only github_merge_pull_request", () => {
    const tools = resolveGitHubActionTools(
      buildCtx({
        toggles: {
          openPullRequest: false,
          commentOnPrOrIssue: false,
          approvePullRequest: false,
          requestChanges: false,
          mergePullRequest: true,
          push: false,
          deleteBranch: false,
        },
      }),
    );
    expect(Object.keys(tools)).toEqual(["github_merge_pull_request"]);
  });
});

// ---------------------------------------------------------------------------
// github_open_pull_request
// ---------------------------------------------------------------------------
describe("github_open_pull_request execute", () => {
  test("happy path: calls openPullRequest with injected scoped octokit, records started/completed events + output row", async () => {
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
      body: "Body text",
      baseBranch: "main",
    });

    expect(result).toMatchObject({
      ok: true,
      prUrl: "https://github.com/acme/widgets/pull/42",
      prNumber: 42,
    });

    expect(openPullRequest).toHaveBeenCalledTimes(1);
    const call = openPullRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.octokit).toBe(mockOctokit);
    expect(call.token).toBeUndefined();

    // token minted + revoked exactly once
    expect(mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(revokeInstallationToken).toHaveBeenCalledTimes(1);
    expect(scopedOctokitCalls[0]?.permissions).toMatchObject({
      pull_requests: "write",
    });

    expect(recordedEventNames()).toEqual([
      "background-agent.github.open_pull_request.started",
      "background-agent.github.open_pull_request.completed",
    ]);

    expect(recordBackgroundAgentOutput).toHaveBeenCalledTimes(1);
    const outputCall = recordBackgroundAgentOutput.mock
      .calls[0]?.[0] as OutputInput;
    expect(outputCall.status).toBe("created");
    expect(outputCall.url).toBe("https://github.com/acme/widgets/pull/42");
    expect(outputCall.prNumber).toBe(42);
  });

  test("write-scope refusal: specific_repos scope excludes the run's own bound repo → refuses with write_scope_denied, no token minted", async () => {
    const ctx = buildCtx({
      repoOwner: "acme",
      repoName: "widgets",
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "acme", name: "some-other-repo" }],
      },
    });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(openPullRequest).not.toHaveBeenCalled();
    expect(mintInstallationToken).not.toHaveBeenCalled();
    expect(verifyRepoAccess).not.toHaveBeenCalled();

    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("write_scope_denied");

    // failure output row is recorded too
    expect(recordBackgroundAgentOutput).toHaveBeenCalledTimes(1);
    const outputCall = recordBackgroundAgentOutput.mock
      .calls[0]?.[0] as OutputInput;
    expect(outputCall.status).toBe("failed");
  });

  test("write-scope refusal: verifyRepoAccess denies access → write_scope_denied", async () => {
    mockAccessResult = { ok: false, reason: "app_no_access" };
    const ctx = buildCtx({ writeScope: { mode: "all_repos" } });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(verifyRepoAccess).toHaveBeenCalledTimes(1);
    expect(openPullRequest).not.toHaveBeenCalled();

    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("write_scope_denied");
  });

  test("specific_repos scope: target repo in the allow-list passes", async () => {
    const ctx = buildCtx({
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "acme", name: "widgets" }],
      },
    });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(openPullRequest).toHaveBeenCalledTimes(1);
  });

  test("specific_repos scope: target repo NOT in the allow-list refuses", async () => {
    const ctx = buildCtx({
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "acme", name: "other-repo" }],
      },
    });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(openPullRequest).not.toHaveBeenCalled();
    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("write_scope_denied");
  });

  test("token mint failure: records failed event with token_mint_failed and returns ok:false", async () => {
    mintTokenShouldFail = true;
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("token_mint_failed");
  });

  test("github api failure: openPullRequest returns success:false → github_api_error, failed event + output row", async () => {
    openPullRequestResult = { success: false, error: "PR already exists" };
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      branchName: "feature-branch",
      title: "Add widget",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("PR already exists");

    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("github_api_error");

    expect(recordedEventNames()).toEqual([
      "background-agent.github.open_pull_request.started",
      "background-agent.github.open_pull_request.failed",
    ]);

    const outputCall = recordBackgroundAgentOutput.mock
      .calls[0]?.[0] as OutputInput;
    expect(outputCall.status).toBe("failed");

    // token still minted + revoked even on failure
    expect(mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(revokeInstallationToken).toHaveBeenCalledTimes(1);
  });

  test("toggle off: openPullRequest excluded from returned tool set when disabled", () => {
    const tools = resolveGitHubActionTools(
      buildCtx({
        toggles: {
          openPullRequest: false,
          commentOnPrOrIssue: true,
          approvePullRequest: true,
          requestChanges: true,
          mergePullRequest: true,
          push: true,
          deleteBranch: true,
        },
      }),
    );
    expect(tools.github_open_pull_request).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// github_comment_on_pr_or_issue
// ---------------------------------------------------------------------------
describe("github_comment_on_pr_or_issue execute", () => {
  test("happy path: creates a comment via issues.createComment with issues:write scope", async () => {
    mockOctokit = {
      rest: {
        issues: {
          createComment: mock(async (args: Record<string, unknown>) => ({
            data: {
              id: 777,
              html_url: `https://github.com/acme/widgets/issues/${args.issue_number}#issuecomment-777`,
            },
          })),
        },
      },
    };

    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_comment_on_pr_or_issue as unknown as ToolExecutor;

    const result = (await tool.execute({
      issueOrPrNumber: 42,
      body: "Looks good.",
    })) as { ok: true; commentId: number; url: string };

    expect(result.ok).toBe(true);
    expect(result.commentId).toBe(777);
    expect(scopedOctokitCalls.at(-1)?.permissions).toMatchObject({
      issues: "write",
    });
    expect(recordedEventNames()).toEqual([
      "background-agent.github.comment_on_pr_or_issue.started",
      "background-agent.github.comment_on_pr_or_issue.completed",
    ]);
  });

  test("no assertNotPullRequest guard: comments on a PR number without a preflight GET", async () => {
    const issuesGet = mock(async () => ({ data: {} }));
    mockOctokit = {
      rest: {
        issues: {
          get: issuesGet,
          createComment: mock(async () => ({
            data: {
              id: 1,
              html_url: "https://github.com/acme/widgets/pull/9#issuecomment-1",
            },
          })),
        },
      },
    };

    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_comment_on_pr_or_issue as unknown as ToolExecutor;

    await tool.execute({ issueOrPrNumber: 9, body: "PR comment" });

    expect(issuesGet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// github_approve_pull_request / github_request_changes
// ---------------------------------------------------------------------------
describe("github_approve_pull_request execute", () => {
  test("happy path: submits an APPROVE review with pull_requests:write scope", async () => {
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_approve_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({
      prNumber: 42,
      body: "LGTM",
    })) as { ok: true };

    expect(result.ok).toBe(true);
    expect(submitPullRequestReview).toHaveBeenCalledTimes(1);
    expect(createReviewCapturedArgs).toMatchObject({
      prNumber: 42,
      event: "APPROVE",
      body: "LGTM",
    });
    expect(scopedOctokitCalls.at(-1)?.permissions).toMatchObject({
      pull_requests: "write",
    });
  });
});

describe("github_request_changes execute", () => {
  test("happy path: submits a REQUEST_CHANGES review", async () => {
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_request_changes as unknown as ToolExecutor;

    const result = (await tool.execute({
      prNumber: 42,
      body: "Please fix X",
    })) as { ok: true };

    expect(result.ok).toBe(true);
    expect(createReviewCapturedArgs).toMatchObject({
      prNumber: 42,
      event: "REQUEST_CHANGES",
      body: "Please fix X",
    });
  });
});

// ---------------------------------------------------------------------------
// github_merge_pull_request
// ---------------------------------------------------------------------------
describe("github_merge_pull_request execute", () => {
  test("happy path (requireCiGreen=false): merges without checking readiness", async () => {
    const ctx = buildCtx({ requireCiGreen: false });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_merge_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({ prNumber: 42 })) as {
      ok: true;
      sha: string;
    };

    expect(result.ok).toBe(true);
    expect(result.sha).toBe("merged-sha");
    expect(getMergeReadinessViaInstallation).not.toHaveBeenCalled();
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });

  test("requireCiGreen=true + canMerge → proceeds to merge", async () => {
    mergeReadinessResult = {
      success: true,
      canMerge: true,
      reasons: [],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 2, passed: 2, pending: 0, failed: 0 },
    };
    const ctx = buildCtx({ requireCiGreen: true });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_merge_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({ prNumber: 42 })) as { ok: true };

    expect(getMergeReadinessViaInstallation).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });

  test("requireCiGreen=true + failed checks → refuses with ci_not_green, does not merge", async () => {
    mergeReadinessResult = {
      success: true,
      canMerge: false,
      reasons: ["Required checks are failing"],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 2, passed: 1, pending: 0, failed: 1 },
    };
    const ctx = buildCtx({ requireCiGreen: true });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_merge_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({ prNumber: 42 })) as {
      ok: false;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(mergePullRequest).not.toHaveBeenCalled();

    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("ci_not_green");
  });

  test("requireCiGreen=true + pending checks → refuses with ci_not_green", async () => {
    mergeReadinessResult = {
      success: true,
      canMerge: false,
      reasons: ["Required checks are still pending"],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 2, passed: 1, pending: 1, failed: 0 },
    };
    const ctx = buildCtx({ requireCiGreen: true });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_merge_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({ prNumber: 42 })) as { ok: false };

    expect(result.ok).toBe(false);
    expect(mergePullRequest).not.toHaveBeenCalled();
    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("ci_not_green");
  });

  test("write-scope refusal for merge", async () => {
    const ctx = buildCtx({
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "acme", name: "nope" }],
      },
    });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_merge_pull_request as unknown as ToolExecutor;

    const result = (await tool.execute({ prNumber: 42 })) as { ok: false };
    expect(result.ok).toBe(false);
    expect(mergePullRequest).not.toHaveBeenCalled();
    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("write_scope_denied");
  });
});

// ---------------------------------------------------------------------------
// github_push
// ---------------------------------------------------------------------------
describe("github_push execute", () => {
  test("happy path: builds commit intent from sandbox and creates a verified commit", async () => {
    const ctx = buildCtx({ sandbox: fakeSandbox });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_push as unknown as ToolExecutor;

    const result = (await tool.execute({
      branch: "feature-branch",
      message: "chore: apply changes",
    })) as { ok: true; sha: string };

    expect(result.ok).toBe(true);
    expect(result.sha).toBe("new-commit-sha");
    expect(buildCommitIntentFromSandbox).toHaveBeenCalledTimes(1);
    expect(createCommit).toHaveBeenCalledTimes(1);
    expect(scopedOctokitCalls.at(-1)?.permissions).toMatchObject({
      contents: "write",
    });
  });

  test("no sandbox provided → github_api_error refusal without minting a token", async () => {
    const ctx = buildCtx({ sandbox: undefined });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_push as unknown as ToolExecutor;

    const result = (await tool.execute({
      branch: "feature-branch",
      message: "chore: apply changes",
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(mintInstallationToken).not.toHaveBeenCalled();
    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent?.errorKind).toBe("github_api_error");
  });
});

// ---------------------------------------------------------------------------
// github_delete_branch
// ---------------------------------------------------------------------------
describe("github_delete_branch execute", () => {
  test("happy path: deletes a non-default branch", async () => {
    const ctx = buildCtx({ defaultBranch: "main" });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_delete_branch as unknown as ToolExecutor;

    const result = (await tool.execute({ branch: "feature-branch" })) as {
      ok: true;
    };

    expect(result.ok).toBe(true);
    expect(deleteBranchRef).toHaveBeenCalledTimes(1);
    expect(scopedOctokitCalls.at(-1)?.permissions).toMatchObject({
      contents: "write",
    });
  });

  test("refuses to delete the repo default branch", async () => {
    const ctx = buildCtx({ defaultBranch: "main" });
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_delete_branch as unknown as ToolExecutor;

    const result = (await tool.execute({ branch: "main" })) as {
      ok: false;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(deleteBranchRef).not.toHaveBeenCalled();
    expect(mintInstallationToken).not.toHaveBeenCalled();

    const failedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".failed"),
    );
    expect(failedEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: audit trail shape
// ---------------------------------------------------------------------------
describe("audit trail", () => {
  test("every event payload includes runId, agentId, targetRepo", async () => {
    const ctx = buildCtx();
    const tools = resolveGitHubActionTools(ctx);
    const tool = tools.github_open_pull_request as unknown as ToolExecutor;

    await tool.execute({ branchName: "feature-branch", title: "Add widget" });

    const startedEvent = recordedEvents().find((event) =>
      event.eventName.endsWith(".started"),
    );
    expect(startedEvent?.payload).toMatchObject({
      runId: "run-1",
      agentId: "agent-1",
      targetRepo: "acme/widgets",
    });
  });
});
