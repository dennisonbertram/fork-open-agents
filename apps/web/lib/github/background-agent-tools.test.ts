import { describe, expect, mock, test } from "bun:test";
import * as realSandbox from "@open-agents/sandbox";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";
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
// `issues.get` deliberately rejects: the comment tool must never call it.
// If a future edit reintroduces the issue-only assertNotPullRequest guard
// (which pre-flights via issues.get), this fake starts failing every
// comment call, catching the regression immediately.
const fakeOctokit = {
  rest: {
    issues: {
      createComment: async (_params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }) => ({ data: { id: 555, html_url: "https://github.com/comment/555" } }),
      get: async () => {
        throw new Error(
          "regression: github_comment_on_pr_or_issue must not call issues.get " +
            "(no assertNotPullRequest pre-flight — it intentionally targets both PRs and issues)",
        );
      },
    },
    pulls: {
      createReview: async (_params: {
        owner: string;
        repo: string;
        pull_number: number;
        event: "APPROVE" | "REQUEST_CHANGES";
        body?: string;
      }) => ({ data: { id: 888, state: "APPROVED" } }),
    },
  },
};

let withScopedInstallationOctokitCallCount = 0;

function resetCapturedMintArgs() {
  capturedMintArgs = null;
  withScopedInstallationOctokitCallCount = 0;
}

// ── merge_pull_request (STEP-7) fixtures ────────────────────────────────────
//
// The merge tool manually spans mint/revoke across two API calls (readiness
// check + merge) with a SINGLE token, unlike every other action tool which
// goes through withPerCallInstallationOctokit/withScopedInstallationOctokit.
// These mocks track mintInstallationToken/revokeInstallationToken directly
// so tests can assert exactly one mint + one revoke per merge call.
let mintInstallationTokenCallCount = 0;
let revokeInstallationTokenCallCount = 0;
let capturedMergeMintArgs: {
  installationId: number;
  repositoryIds: number[];
  permissions: Record<string, string>;
} | null = null;
let revokedTokens: string[] = [];

function resetMergeTokenMocks() {
  mintInstallationTokenCallCount = 0;
  revokeInstallationTokenCallCount = 0;
  capturedMergeMintArgs = null;
  revokedTokens = [];
}

const mintInstallationToken = mock(
  async (params: {
    installationId: number;
    repositoryIds: number[];
    permissions: Record<string, string>;
  }) => {
    mintInstallationTokenCallCount += 1;
    capturedMergeMintArgs = {
      installationId: params.installationId,
      repositoryIds: params.repositoryIds,
      permissions: params.permissions,
    };
    return {
      token: "merge-scoped-token",
      expiresAt: null,
      installationId: params.installationId,
      repositoryIds: params.repositoryIds,
      permissions: params.permissions,
    };
  },
);

const revokeInstallationToken = mock(async (token: string) => {
  revokeInstallationTokenCallCount += 1;
  revokedTokens.push(token);
});

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
  mintInstallationToken,
  revokeInstallationToken,
}));

const getMergeReadiness = mock(
  async (_params: { repoUrl: string; prNumber: number; token?: string }) => ({
    success: true,
    canMerge: true,
    reasons: [] as string[],
    allowedMethods: ["squash"] as const,
    defaultMethod: "squash" as const,
    checks: { requiredTotal: 2, passed: 2, pending: 0, failed: 0 },
    checkRuns: [],
  }),
);

const mergePullRequest = mock(
  async (_params: {
    repoUrl: string;
    prNumber: number;
    mergeMethod?: string;
    commitTitle?: string;
    commitMessage?: string;
    token?: string;
  }) => ({
    success: true,
    sha: "merged-sha-1",
  }),
);

function resetMergeApiMocks() {
  getMergeReadiness.mockClear();
  getMergeReadiness.mockImplementation(async () => ({
    success: true,
    canMerge: true,
    reasons: [],
    allowedMethods: ["squash"],
    defaultMethod: "squash",
    checks: { requiredTotal: 2, passed: 2, pending: 0, failed: 0 },
    checkRuns: [],
  }));
  mergePullRequest.mockClear();
  mergePullRequest.mockImplementation(async () => ({
    success: true,
    sha: "merged-sha-1",
  }));
}

// ── open_pull_request (STEP-5) fixtures ─────────────────────────────────────
//
// Mirrors the low-level mocking pattern established in executor.test.ts:
// performReadyPullRequest (ready-pr-runner.ts) is exercised for real, only
// its underlying sandbox/GitHub calls are mocked — so these tests prove the
// tool's real integration with the extracted commit+PR logic, not a mocked
// stand-in for it.

const successfulExec: ExecResult = {
  success: true,
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  truncated: false,
};

let sandboxCommandResults = new Map<string, ExecResult>();

const sandboxExec = mock(async (command: string): Promise<ExecResult> => {
  if (sandboxCommandResults.has(command)) {
    return sandboxCommandResults.get(command) ?? successfulExec;
  }
  if (command.includes("git checkout")) {
    return sandboxCommandResults.get("git checkout") ?? successfulExec;
  }
  return successfulExec;
});

const fakeReadyPrSandbox = {
  workingDirectory: "/workspace/widgets",
  exec: sandboxExec,
} as unknown as Sandbox;

const hasUncommittedChanges = mock(async () => true);
const stageAll = mock(async () => undefined);
const getStagedDiff = mock(async () => "diff --git a/README.md b/README.md");

const buildCoAuthor = mock(async () => ({
  name: "mona",
  email: "1+mona@users.noreply.github.com",
}));
const createCommit = mock(async () => ({
  ok: true,
  commitSha: "commit-sha-1",
}));
const buildCommitIntentFromSandbox = mock(async () => ({
  ok: true,
  intent: {
    owner: "acme",
    repo: "my-repo",
    repositoryId: 99,
    installationId: 42,
    branch: "background-agent/review-agent/run-1",
    baseBranch: "main",
    expectedHeadSha: "base-sha",
    message: "chore: apply Review Agent background changes",
    files: [{ path: "README.md", content: "Updated", mode: "100644" }],
    coAuthor: { name: "mona", email: "1+mona@users.noreply.github.com" },
  },
}));
const openPullRequest = mock(
  async (_input: {
    repoUrl: string;
    branchName: string;
    title: string;
    body?: string;
    baseBranch?: string;
    token?: string;
  }) => ({
    success: true,
    prUrl: "https://github.com/acme/my-repo/pull/7",
    prNumber: 7,
  }),
);
const getGitHubAppUserToken = mock(async () => "user-token");

function resetReadyPrMocks() {
  sandboxCommandResults = new Map<string, ExecResult>();
  sandboxExec.mockClear();
  hasUncommittedChanges.mockClear();
  hasUncommittedChanges.mockImplementation(async () => true);
  stageAll.mockClear();
  getStagedDiff.mockClear();
  buildCoAuthor.mockClear();
  createCommit.mockClear();
  buildCommitIntentFromSandbox.mockClear();
  openPullRequest.mockClear();
  openPullRequest.mockImplementation(async () => ({
    success: true,
    prUrl: "https://github.com/acme/my-repo/pull/7",
    prNumber: 7,
  }));
  getGitHubAppUserToken.mockClear();
}

// Spread the REAL module's other exports (connectSandbox, etc.) rather than
// replacing the module wholesale — ready-pr.ts's transitive import of
// "@open-agents/agent" (via lib/git/helpers.ts) pulls in a real value import
// of connectSandbox from this same module, which a partial mock would break.
mock.module("@open-agents/sandbox", () => ({
  ...realSandbox,
  hasUncommittedChanges,
  stageAll,
  getStagedDiff,
}));

mock.module("@/lib/github/commit", () => ({
  buildCoAuthor,
  createCommit,
}));

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox,
}));

mock.module("@/lib/github/pulls", () => ({
  openPullRequest,
  getMergeReadiness,
  mergePullRequest,
}));

mock.module("@/lib/github/token", () => ({
  getGitHubAppUserToken,
}));

const {
  resolveGitHubActionToolsForBackgroundAgent,
  withPerCallInstallationOctokit,
  recordActionEvent,
} = await import("./background-agent-tools");

type Ctx = Parameters<typeof resolveGitHubActionToolsForBackgroundAgent>[0];

// AI SDK tool() results type execute() loosely for provider-option
// inference; tests only need to call it directly, so narrow via `unknown`
// (never `any`) to the concrete signature under test.
type CommentToolExecute = (
  input: { number: number; body: string },
  options: unknown,
) => Promise<unknown>;

function getCommentToolExecute(
  tools: ReturnType<typeof resolveGitHubActionToolsForBackgroundAgent>,
): CommentToolExecute {
  const commentTool = tools.github_comment_on_pr_or_issue as unknown as {
    execute: CommentToolExecute;
  };
  return commentTool.execute;
}

function buildCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    installationId: 42,
    repositoryId: 99,
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

    // comment_on_pr_or_issue (STEP-4), open_pull_request (STEP-5),
    // approve_pull_request/request_changes (STEP-6), and merge_pull_request
    // (STEP-7) are implemented; push/delete_branch remain absent until their
    // STEP-8 tool builders ship. Order follows enabledActions input order
    // (the resolver iterates enabledActions directly).
    expect(Object.keys(tools)).toEqual([
      "github_open_pull_request",
      "github_comment_on_pr_or_issue",
      "github_approve_pull_request",
      "github_request_changes",
      "github_merge_pull_request",
    ]);
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
    expect(tools.github_comment_on_pr_or_issue).toBeDefined();

    const execute = getCommentToolExecute(tools);
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
    const execute = getCommentToolExecute(tools);

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
      const execute = getCommentToolExecute(tools);

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

  test("regression: comments on a PR number without any assertNotPullRequest pre-flight, and mints issues:write only (never pull_requests:write)", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({
      enabledActions: ["comment_on_pr_or_issue"],
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getCommentToolExecute(tools);

    // 42 stands in for a PR number here — the shared issues.createComment
    // endpoint works for both issues and PRs, and this tool must not
    // pre-flight-check the item type (fakeOctokit.rest.issues.get rejects
    // if called, which would fail this test if a guard were added back).
    const result = await execute({ number: 42, body: "lgtm" }, {});

    expect(result).toEqual({
      ok: true,
      commentId: 555,
      url: "https://github.com/comment/555",
    });
    // Regression guard: widening to pull_requests:write (or adding it
    // alongside issues:write) would needlessly broaden the minted token
    // beyond what commenting requires.
    expect(capturedMintArgs?.permissions).toEqual({ issues: "write" });
  });
});

// AI SDK tool() results type execute() loosely for provider-option
// inference; tests only need to call it directly, so narrow via `unknown`
// (never `any`) to the concrete signature under test.
type OpenPullRequestToolExecute = (
  input: { title?: string; body?: string },
  options: unknown,
) => Promise<unknown>;

function getOpenPullRequestToolExecute(
  tools: ReturnType<typeof resolveGitHubActionToolsForBackgroundAgent>,
): OpenPullRequestToolExecute {
  const openPrTool = tools.github_open_pull_request as unknown as {
    execute: OpenPullRequestToolExecute;
  };
  return openPrTool.execute;
}

describe("github_open_pull_request tool", () => {
  test("is absent from the tool set when open_pull_request is not enabled", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({ enabledActions: [] }),
    );

    expect(tools.github_open_pull_request).toBeUndefined();
  });

  test("checkCommand gate: returns check_command_failed and never opens a PR when the check command fails", async () => {
    resetReadyPrMocks();
    sandboxCommandResults.set("exit 1", {
      success: false,
      stdout: "",
      stderr: "tests failed",
      exitCode: 1,
      truncated: false,
    });
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      checkCommand: "exit 1",
      sandbox: fakeReadyPrSandbox,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    const result = await execute({}, {});

    expect(result).toEqual({
      ok: false,
      errorKind: "check_command_failed",
      error: expect.stringContaining("exit 1"),
    });
    // The gate must short-circuit BEFORE any commit/PR work — proves the
    // checkCommand enforcement lives inside the tool's execute(), not just
    // as a prompt instruction.
    expect(hasUncommittedChanges).not.toHaveBeenCalled();
    expect(openPullRequest).not.toHaveBeenCalled();
  });

  test("happy path: commits staged changes and opens a pull request when the check command passes", async () => {
    resetReadyPrMocks();
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      checkCommand: "bun test",
      sandbox: fakeReadyPrSandbox,
      repositoryId: 99,
      repositoryIds: [99],
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    const result = await execute({}, {});

    expect(result).toEqual({
      ok: true,
      prUrl: "https://github.com/acme/my-repo/pull/7",
      prNumber: 7,
    });
    expect(openPullRequest).toHaveBeenCalledTimes(1);
    const prCall = openPullRequest.mock.calls[0]?.[0] as {
      baseBranch?: string;
      token?: string;
    };
    expect(prCall?.baseBranch).toBe("main");
    expect(prCall?.token).toBe("user-token");
  });

  test("records a background-agent.github.open_pull_request event with rich attribution on success", async () => {
    resetReadyPrMocks();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      sandbox: fakeReadyPrSandbox,
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    await execute({}, {});

    const openPrEvent = recorded.find(
      (event) =>
        event.eventName === "background-agent.github.open_pull_request",
    );
    expect(openPrEvent).toBeDefined();
    expect(openPrEvent?.status).toBe("succeeded");
    expect(openPrEvent?.payload?.severity).toBe("low");
    expect(openPrEvent?.payload?.prNumber).toBe(7);
  });

  test("returns no_changes when the sandbox has no uncommitted changes, without calling openPullRequest", async () => {
    resetReadyPrMocks();
    hasUncommittedChanges.mockImplementation(async () => false);
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      sandbox: fakeReadyPrSandbox,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    const result = await execute({}, {});

    expect(result).toEqual({
      ok: false,
      errorKind: "no_changes",
      error: "Background agent completed without file changes.",
    });
    expect(openPullRequest).not.toHaveBeenCalled();
  });

  test("regression: checks out the agent branch before building the commit intent, so the commit lands on the agent branch rather than the base checkout", async () => {
    resetReadyPrMocks();
    const callOrder: string[] = [];
    sandboxExec.mockImplementation(async (command: string) => {
      if (command.includes("git checkout")) {
        callOrder.push("git checkout");
      }
      return successfulExec;
    });
    buildCommitIntentFromSandbox.mockImplementation(async () => {
      callOrder.push("buildCommitIntentFromSandbox");
      return {
        ok: true,
        intent: {
          owner: "acme",
          repo: "my-repo",
          repositoryId: 99,
          installationId: 42,
          branch: "background-agent/review-agent/run-1",
          baseBranch: "main",
          expectedHeadSha: "base-sha",
          message: "chore: apply Review Agent background changes",
          files: [{ path: "README.md", content: "Updated", mode: "100644" }],
          coAuthor: { name: "mona", email: "1+mona@users.noreply.github.com" },
        },
      };
    });
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      sandbox: fakeReadyPrSandbox,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    await execute({}, {});

    expect(callOrder).toEqual(["git checkout", "buildCommitIntentFromSandbox"]);
  });

  test("regression: opens the pull request with the user's OAuth token (getGitHubAppUserToken), never the installation token used for the commit", async () => {
    resetReadyPrMocks();
    resetCapturedMintArgs();
    getGitHubAppUserToken.mockImplementation(async () => "distinct-user-token");
    const ctx = buildCtx({
      enabledActions: ["open_pull_request"],
      sandbox: fakeReadyPrSandbox,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getOpenPullRequestToolExecute(tools);

    await execute({}, {});

    // The commit uses a per-call installation token (via
    // withScopedInstallationOctokit, minted with contents:write); the PR
    // itself must use the separate user OAuth token instead — this
    // asymmetry is preserved from the pre-extraction behavior and must
    // never collapse into a single installation-token call.
    expect(capturedMintArgs?.permissions).toEqual({ contents: "write" });
    const prCall = openPullRequest.mock.calls[0]?.[0] as { token?: string };
    expect(prCall?.token).toBe("distinct-user-token");
  });
});

// AI SDK tool() results type execute() loosely for provider-option
// inference; tests only need to call it directly, so narrow via `unknown`
// (never `any`) to the concrete signature under test.
type ApproveToolExecute = (
  input: { prNumber: number; body?: string },
  options: unknown,
) => Promise<unknown>;

type RequestChangesToolExecute = (
  input: { prNumber: number; body: string },
  options: unknown,
) => Promise<unknown>;

function getApproveToolExecute(
  tools: ReturnType<typeof resolveGitHubActionToolsForBackgroundAgent>,
): ApproveToolExecute {
  const approveTool = tools.github_approve_pull_request as unknown as {
    execute: ApproveToolExecute;
  };
  return approveTool.execute;
}

function getRequestChangesToolExecute(
  tools: ReturnType<typeof resolveGitHubActionToolsForBackgroundAgent>,
): RequestChangesToolExecute {
  const requestChangesTool = tools.github_request_changes as unknown as {
    execute: RequestChangesToolExecute;
  };
  return requestChangesTool.execute;
}

describe("github_approve_pull_request tool", () => {
  test("is absent from the tool set when approve_pull_request is not enabled", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({ enabledActions: [] }),
    );

    expect(tools.github_approve_pull_request).toBeUndefined();
  });

  test("approves a pull request via pulls.createReview scoped to pull_requests:write and the full write-scope repositoryIds", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({
      repositoryIds: [11, 22, 33],
      repoOwner: "acme",
      repoName: "my-repo",
      enabledActions: ["approve_pull_request"],
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    expect(tools.github_approve_pull_request).toBeDefined();

    const execute = getApproveToolExecute(tools);
    const result = await execute({ prNumber: 12 }, {});

    expect(result).toEqual({ ok: true, reviewId: 888, state: "APPROVED" });
    expect(capturedMintArgs).toEqual({
      installationId: ctx.installationId,
      repositoryIds: [11, 22, 33],
      permissions: { pull_requests: "write" },
    });
    expect(withScopedInstallationOctokitCallCount).toBe(1);
  });

  test("accepts an optional body for an approval", async () => {
    resetCapturedMintArgs();
    let capturedCreateReviewParams: Record<string, unknown> | null = null;
    const originalCreateReview = fakeOctokit.rest.pulls.createReview;
    fakeOctokit.rest.pulls.createReview = async (params) => {
      capturedCreateReviewParams = params;
      return { data: { id: 888, state: "APPROVED" } };
    };

    try {
      const ctx = buildCtx({ enabledActions: ["approve_pull_request"] });
      const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
      const execute = getApproveToolExecute(tools);

      await execute({ prNumber: 12, body: "Looks great" }, {});

      expect(capturedCreateReviewParams).toMatchObject({
        pull_number: 12,
        event: "APPROVE",
        body: "Looks great",
      });
    } finally {
      fakeOctokit.rest.pulls.createReview = originalCreateReview;
    }
  });

  test("records a background-agent.github.approve_pull_request event with attribution on success", async () => {
    resetCapturedMintArgs();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["approve_pull_request"],
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getApproveToolExecute(tools);

    await execute({ prNumber: 12 }, {});

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.eventName).toBe(
      "background-agent.github.approve_pull_request",
    );
    expect(recorded[0]?.status).toBe("succeeded");
    expect(recorded[0]?.payload?.prNumber).toBe(12);
    expect(recorded[0]?.payload?.reviewId).toBe(888);
    expect(recorded[0]?.payload?.event).toBe("APPROVE");
  });

  test("returns a typed access_error result and records a failed event when the API call throws", async () => {
    resetCapturedMintArgs();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["approve_pull_request"],
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });
    const originalCreateReview = fakeOctokit.rest.pulls.createReview;
    fakeOctokit.rest.pulls.createReview = async () => {
      throw new Error(
        "boom: Review cannot be approved by the app that opened the pull request",
      );
    };

    try {
      const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
      const execute = getApproveToolExecute(tools);

      const result = await execute({ prNumber: 12 }, {});

      expect(result).toEqual({
        ok: false,
        errorKind: "access_error",
        error:
          "boom: Review cannot be approved by the app that opened the pull request",
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.status).toBe("failed");
    } finally {
      fakeOctokit.rest.pulls.createReview = originalCreateReview;
    }
  });
});

describe("github_request_changes tool", () => {
  test("is absent from the tool set when request_changes is not enabled", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({ enabledActions: [] }),
    );

    expect(tools.github_request_changes).toBeUndefined();
  });

  test("requests changes via pulls.createReview scoped to pull_requests:write with a required body", async () => {
    resetCapturedMintArgs();
    let capturedCreateReviewParams: Record<string, unknown> | null = null;
    const originalCreateReview = fakeOctokit.rest.pulls.createReview;
    fakeOctokit.rest.pulls.createReview = async (params) => {
      capturedCreateReviewParams = params;
      return { data: { id: 999, state: "CHANGES_REQUESTED" } };
    };

    try {
      const ctx = buildCtx({
        repositoryIds: [11, 22, 33],
        enabledActions: ["request_changes"],
      });

      const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
      expect(tools.github_request_changes).toBeDefined();

      const execute = getRequestChangesToolExecute(tools);
      const result = await execute(
        { prNumber: 12, body: "Please add tests." },
        {},
      );

      expect(result).toEqual({
        ok: true,
        reviewId: 999,
        state: "CHANGES_REQUESTED",
      });
      expect(capturedCreateReviewParams).toMatchObject({
        pull_number: 12,
        event: "REQUEST_CHANGES",
        body: "Please add tests.",
      });
      expect(capturedMintArgs).toEqual({
        installationId: ctx.installationId,
        repositoryIds: [11, 22, 33],
        permissions: { pull_requests: "write" },
      });
    } finally {
      fakeOctokit.rest.pulls.createReview = originalCreateReview;
    }
  });

  test("regression: rejects an empty body via the input schema before calling createReview (GitHub 422s REQUEST_CHANGES without a body)", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({ enabledActions: ["request_changes"] });
    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const requestChangesTool = tools.github_request_changes as unknown as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };

    const parsed = requestChangesTool.inputSchema.safeParse({
      prNumber: 12,
      body: "",
    });

    expect(parsed.success).toBe(false);
    expect(withScopedInstallationOctokitCallCount).toBe(0);
  });

  test("records a background-agent.github.request_changes event with attribution on success", async () => {
    resetCapturedMintArgs();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["request_changes"],
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getRequestChangesToolExecute(tools);

    await execute({ prNumber: 12, body: "Please add tests." }, {});

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.eventName).toBe(
      "background-agent.github.request_changes",
    );
    expect(recorded[0]?.status).toBe("succeeded");
    expect(recorded[0]?.payload?.prNumber).toBe(12);
    expect(recorded[0]?.payload?.event).toBe("REQUEST_CHANGES");
  });

  test("regression: mints pull_requests:write only (never issues:write or contents:write) with exactly one mint-and-revoke per call, for both approve and request_changes", async () => {
    resetCapturedMintArgs();
    const ctx = buildCtx({
      enabledActions: ["approve_pull_request", "request_changes"],
    });
    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);

    const approveExecute = getApproveToolExecute(tools);
    await approveExecute({ prNumber: 12 }, {});

    // Regression guard: a future edit that widens this to issues:write
    // (mirroring the comment tool) or adds contents:write would needlessly
    // broaden the minted token beyond what a PR review requires — review
    // actions must stay on pull_requests:write only.
    expect(capturedMintArgs?.permissions).toEqual({ pull_requests: "write" });
    expect(withScopedInstallationOctokitCallCount).toBe(1);

    resetCapturedMintArgs();
    const requestChangesExecute = getRequestChangesToolExecute(tools);
    await requestChangesExecute(
      { prNumber: 12, body: "Please add tests." },
      {},
    );

    expect(capturedMintArgs?.permissions).toEqual({ pull_requests: "write" });
    // Per-call mint-and-revoke: exactly one withScopedInstallationOctokit
    // call for this single tool invocation — no standing credential exists
    // across the two review calls above (each mints and revokes its own
    // token, never reusing a token minted for a prior call).
    expect(withScopedInstallationOctokitCallCount).toBe(1);
  });
});

// AI SDK tool() results type execute() loosely for provider-option
// inference; tests only need to call it directly, so narrow via `unknown`
// (never `any`) to the concrete signature under test.
type MergeToolExecute = (
  input: {
    prNumber: number;
    mergeMethod?: "merge" | "squash" | "rebase";
    commitTitle?: string;
    commitMessage?: string;
  },
  options: unknown,
) => Promise<unknown>;

function getMergeToolExecute(
  tools: ReturnType<typeof resolveGitHubActionToolsForBackgroundAgent>,
): MergeToolExecute {
  const mergeTool = tools.github_merge_pull_request as unknown as {
    execute: MergeToolExecute;
  };
  return mergeTool.execute;
}

describe("github_merge_pull_request tool", () => {
  test("is absent from the tool set when merge_pull_request is not enabled", () => {
    const tools = resolveGitHubActionToolsForBackgroundAgent(
      buildCtx({ enabledActions: [] }),
    );

    expect(tools.github_merge_pull_request).toBeUndefined();
  });

  test("gate ON, checks not green: blocks the merge with merge_blocked_ci_not_green and never calls mergePullRequest", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    getMergeReadiness.mockImplementation(async () => ({
      success: true,
      canMerge: false,
      reasons: ["checks pending"],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 2, passed: 1, pending: 1, failed: 0 },
      checkRuns: [],
    }));
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    const result = await execute({ prNumber: 12 }, {});

    expect(result).toEqual({
      ok: false,
      errorKind: "merge_blocked_ci_not_green",
      error: "checks pending",
      checks: { requiredTotal: 2, passed: 1, pending: 1, failed: 0 },
    });
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  test("gate ON, checks green: merges and returns the merged sha", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    const result = await execute({ prNumber: 12, mergeMethod: "squash" }, {});

    expect(result).toEqual({ ok: true, sha: "merged-sha-1" });
    expect(getMergeReadiness).toHaveBeenCalledTimes(1);
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });

  test("gate OFF: never calls getMergeReadiness and merges regardless of check state", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    getMergeReadiness.mockImplementation(async () => ({
      success: true,
      canMerge: false,
      reasons: ["checks failing"],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 2, passed: 0, pending: 0, failed: 2 },
      checkRuns: [],
    }));
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: false,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    const result = await execute({ prNumber: 12 }, {});

    expect(result).toEqual({ ok: true, sha: "merged-sha-1" });
    expect(getMergeReadiness).not.toHaveBeenCalled();
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });

  test("mints exactly one installation token spanning both the readiness check and the merge, and revokes it exactly once", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    const ctx = buildCtx({
      repositoryIds: [11, 22, 33],
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    await execute({ prNumber: 12 }, {});

    expect(mintInstallationTokenCallCount).toBe(1);
    expect(revokeInstallationTokenCallCount).toBe(1);
    expect(capturedMergeMintArgs).toEqual({
      installationId: ctx.installationId,
      repositoryIds: [11, 22, 33],
      permissions: { pull_requests: "write", contents: "write" },
    });
    expect(revokedTokens).toEqual(["merge-scoped-token"]);
  });

  test("records a background-agent.github.merge_pull_request event with rich attribution on success", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    const recorded: BackgroundAgentGitHubEventInput[] = [];
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
      recordEvent: async (event) => {
        recorded.push(event);
      },
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    await execute({ prNumber: 12, mergeMethod: "squash" }, {});

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.eventName).toBe(
      "background-agent.github.merge_pull_request",
    );
    expect(recorded[0]?.status).toBe("succeeded");
    expect(recorded[0]?.payload?.prNumber).toBe(12);
    expect(recorded[0]?.payload?.mergeMethod).toBe("squash");
    expect(recorded[0]?.payload?.requireCiGreenToMerge).toBe(true);
    expect(recorded[0]?.payload?.mergedSha).toBe("merged-sha-1");
    expect(recorded[0]?.payload?.ciChecksSummary).toEqual({
      requiredTotal: 2,
      passed: 2,
      pending: 0,
      failed: 0,
    });
    expect(recorded[0]?.payload?.severity).toBe("high");
  });

  test("regression: getMergeReadiness and mergePullRequest are called with the SAME minted token (one token spans both calls, not two separate mints)", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    let readinessToken: string | undefined;
    let mergeToken: string | undefined;
    getMergeReadiness.mockImplementation(async (params) => {
      readinessToken = params.token;
      return {
        success: true,
        canMerge: true,
        reasons: [],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 1, passed: 1, pending: 0, failed: 0 },
        checkRuns: [],
      };
    });
    mergePullRequest.mockImplementation(async (params) => {
      mergeToken = params.token;
      return { success: true, sha: "merged-sha-1" };
    });
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    await execute({ prNumber: 12 }, {});

    expect(readinessToken).toBe("merge-scoped-token");
    expect(mergeToken).toBe("merge-scoped-token");
    expect(mintInstallationTokenCallCount).toBe(1);
  });

  test("returns merge_conflict when mergePullRequest fails with a 409 status", async () => {
    resetMergeTokenMocks();
    resetMergeApiMocks();
    mergePullRequest.mockImplementation(async () => ({
      success: false,
      error: "Pull request has conflicts or is out of date",
      statusCode: 409,
    }));
    const ctx = buildCtx({
      enabledActions: ["merge_pull_request"],
      requireCiGreenToMerge: true,
    });

    const tools = resolveGitHubActionToolsForBackgroundAgent(ctx);
    const execute = getMergeToolExecute(tools);

    const result = await execute({ prNumber: 12 }, {});

    expect(result).toEqual({
      ok: false,
      errorKind: "merge_conflict",
      error: "Pull request has conflicts or is out of date",
    });
    // The token must still be revoked even though the merge itself failed.
    expect(revokeInstallationTokenCallCount).toBe(1);
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
