import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

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

type OutputRow = OutputInput & { id: string };

type StatusUpdateInput = {
  runId: string;
  status: BackgroundAgentRun["status"];
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
};

type ConnectSandboxInput = {
  state: {
    type: string;
    sandboxName: string;
    source: {
      repo: string;
      branch: string;
    };
  };
  options: {
    githubToken?: string;
    persistent?: boolean;
    resume?: boolean;
    createIfMissing?: boolean;
  };
};

const successfulAccess = {
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
  userPermission: "write",
} as const;

const successfulCommand: ExecResult = {
  success: true,
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  truncated: false,
};

let currentRun: BackgroundAgentRun;
let currentAgent: BackgroundAgent | null;
let commandResults = new Map<string, ExecResult>();
let recordedOutputs: OutputRow[] = [];
let outputIdCounter = 0;

const getBackgroundAgentRunWithAgent = mock(async () => ({
  run: currentRun,
  agent: currentAgent,
}));
const recordBackgroundAgentEvent = mock(async (input: EventInput) => input);
const recordBackgroundAgentOutput = mock(async (input: OutputInput) => {
  outputIdCounter += 1;
  const row: OutputRow = { ...input, id: `output-${outputIdCounter}` };
  recordedOutputs.push(row);
  return row;
});
const listBackgroundAgentOutputsMock = mock(
  async (_runId: string): Promise<OutputRow[]> => recordedOutputs,
);
const updateBackgroundAgentRunStatus = mock(
  async (input: StatusUpdateInput): Promise<BackgroundAgentRun> => ({
    ...currentRun,
    status: input.status,
    workflowRunId: input.workflowRunId ?? currentRun.workflowRunId,
    sandboxName: input.sandboxName ?? currentRun.sandboxName,
    errorKind: input.errorKind ?? currentRun.errorKind,
    errorMessage: input.errorMessage ?? currentRun.errorMessage,
    outputUrl: input.outputUrl ?? currentRun.outputUrl,
  }),
);

const sandboxExec = mock(async (command: string): Promise<ExecResult> => {
  if (commandResults.has(command)) {
    return commandResults.get(command) ?? successfulCommand;
  }
  if (command.includes("git checkout")) {
    return commandResults.get("git checkout") ?? successfulCommand;
  }
  return successfulCommand;
});

const fakeSandbox = {
  workingDirectory: "/workspace/widgets",
  currentBranch: "main",
  environmentDetails: "Vercel Sandbox test runtime",
  host: "sandbox.example",
  exec: sandboxExec,
  getState: () => ({
    type: "vercel",
    sandboxName: `background_agent_${currentRun.id}`,
  }),
} as unknown as Sandbox;

const connectSandbox = mock(async (_input: ConnectSandboxInput) => fakeSandbox);
const getCurrentBranch = mock(
  async () => "background-agent/smoke-fixer/run_12345678",
);
const getStagedDiff = mock(async () => "diff --git a/README.md b/README.md");
const hasUncommittedChanges = mock(async () => true);
const stageAll = mock(async () => undefined);

const verifyRepoAccess = mock(async () => successfulAccess);
const getRepoAccessErrorMessage = mock((reason: string) => reason);
const mintInstallationToken = mock(async () => ({ token: "setup-token" }));
const revokeInstallationToken = mock(async () => undefined);
const withScopedInstallationOctokit = mock(
  async (params: {
    operation: (octokit: unknown) => Promise<unknown>;
  }): Promise<unknown> => params.operation({}),
);
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
    repo: "widgets",
    repositoryId: 42,
    installationId: 99,
    branch: "background-agent/smoke-fixer/run_12345678",
    baseBranch: "main",
    expectedHeadSha: "base-sha",
    message: "chore: apply Smoke fixer background changes",
    files: [
      {
        path: "README.md",
        content: "Updated",
        mode: "100644",
      },
    ],
    coAuthor: {
      name: "mona",
      email: "1+mona@users.noreply.github.com",
    },
  },
}));
const openPullRequest = mock(async () => ({
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/42",
  prNumber: 42,
}));
const mergePullRequest = mock(async () => ({ success: true, sha: "merged" }));
const submitPullRequestReview = mock(async () => ({
  success: true,
  reviewId: 1,
}));
const deleteBranchRef = mock(async () => ({ success: true }));
const getMergeReadinessViaInstallation = mock(async () => ({
  canMerge: true,
  checks: { failed: 0, pending: 0, passed: 1 },
  reasons: [] as string[],
}));
const getGitHubAppUserToken = mock(async () => "user-token");
const getGitHubUserProfile = mock(async () => ({
  username: "mona",
  externalUserId: "1",
}));
const generate = mock(async () => ({
  finishReason: "stop",
  rawFinishReason: "stop",
  response: {
    messages: [],
  },
  steps: [],
  usage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
  totalUsage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
}));

const listBackgroundAgentEvents = mock(async () => []);
const recordUsage = mock(async () => undefined);

mock.module("./store", () => ({
  seedTriggerNextRunAt: async () => undefined,
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs: listBackgroundAgentOutputsMock,
  // needed by builtin-agent.ts (imported via isLearningsAgent in executor.ts)
  listRepoBackgroundAgents: mock(async () => []),
  listBackgroundAgents: mock(async () => []),
  createBackgroundAgent: mock(async () => ({})),
  updateBackgroundAgent: mock(async () => null),
}));

mock.module("./run-summary", () => ({
  buildRunSummary: mock(() => ({
    headline: "Run succeeded",
    checked: [],
    changed: [],
    blocked: [],
    artifacts: [],
    next: [],
  })),
}));

mock.module("./run-summary-persist", () => ({
  persistRunSummary: mock(async () => undefined),
  recordSummaryFailedEvent: mock(async () => undefined),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox,
  getCurrentBranch,
  getStagedDiff,
  hasUncommittedChanges,
  stageAll,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: "snapshot-test",
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess,
  getRepoAccessErrorMessage,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
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
  mergePullRequest,
  submitPullRequestReview,
  deleteBranchRef,
  getMergeReadinessViaInstallation,
}));

mock.module("@/lib/github/token", () => ({
  getGitHubAppUserToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile,
}));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: (modelId: string) => modelId,
  defaultModelLabel: "anthropic/claude-opus-4.6",
  openAgent: {
    generate,
  },
}));

mock.module("@/lib/inference/model-option-id", () => ({
  USER_INFERENCE_OPTION_PREFIX: "user-profile:",
  parseModelOptionSelection: (optionId: string) => ({
    modelId: optionId,
    inferenceProfileId: null,
  }),
  getModelOptionSelectionId: (modelId: string | null | undefined) =>
    modelId ?? "",
}));

mock.module("@/lib/inference/profile-resolution", () => ({
  resolveInferenceProfileModelSelection: mock(
    async (params: { selection: unknown }) => params.selection,
  ),
}));

const executorModulePromise = import("./executor");
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

function buildRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "run_1234567890abcdef",
    agentId: "agent-1",
    triggerId: "trigger-1",
    userId: "user-1",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-1",
    idempotencyKey: "idempotency-1",
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: "abc123",
    branch: null,
    prNumber: 7,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputKind: null,
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {
      title: "Fix widgets",
      actor: "mona",
    },
    requestId: "req-1",
    workflowRunId: null,
    startedAt: null,
    finishedAt: null,
    resultSummary: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildAgent(overrides: Partial<BackgroundAgent> = {}): BackgroundAgent {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Smoke fixer",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Fix the failing smoke check.",
    permissions: {},
    outputMode: "none",
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: {
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    },
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    modelId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function recordedEvents() {
  return recordBackgroundAgentEvent.mock.calls.map(([input]) => input);
}

function recordedStatusUpdates() {
  return updateBackgroundAgentRunStatus.mock.calls.map(([input]) => input);
}

function recordedEvent(name: string) {
  return recordedEvents().find((event) => event.eventName === name);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  commandResults = new Map<string, ExecResult>();
  recordedOutputs = [];
  outputIdCounter = 0;
  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  listBackgroundAgentOutputsMock.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  sandboxExec.mockClear();
  connectSandbox.mockClear();
  getCurrentBranch.mockClear();
  getStagedDiff.mockClear();
  hasUncommittedChanges.mockClear();
  stageAll.mockClear();
  verifyRepoAccess.mockClear();
  getRepoAccessErrorMessage.mockClear();
  mintInstallationToken.mockClear();
  revokeInstallationToken.mockClear();
  withScopedInstallationOctokit.mockClear();
  buildCoAuthor.mockClear();
  createCommit.mockClear();
  buildCommitIntentFromSandbox.mockClear();
  openPullRequest.mockClear();
  mergePullRequest.mockClear();
  submitPullRequestReview.mockClear();
  deleteBranchRef.mockClear();
  getMergeReadinessViaInstallation.mockClear();
  getGitHubAppUserToken.mockClear();
  getGitHubUserProfile.mockClear();
  generate.mockClear();
  recordUsage.mockClear();
});

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
    return;
  }
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

afterAll(() => {
  mock.restore();
});

describe("executeBackgroundAgentRun", () => {
  test("starts a resumable sandbox, resolves read access for a comment-only agent, and runs the agent loop", async () => {
    currentAgent = buildAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "read",
    });
    expect(mintInstallationToken).toHaveBeenCalledWith({
      installationId: 99,
      repositoryIds: [42],
      permissions: { contents: "read" },
    });
    const connectCall = connectSandbox.mock.calls[0]?.[0] as
      | ConnectSandboxInput
      | undefined;
    expect(connectCall).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "background_agent_run_1234567890abcdef",
        source: {
          repo: "https://github.com/acme/widgets.git",
          branch: "main",
        },
      },
      options: {
        githubToken: "setup-token",
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
    expect(revokeInstallationToken).toHaveBeenCalledWith("setup-token");

    // The agent loop always runs now — no more outputMode gate.
    expect(generate).toHaveBeenCalledTimes(1);

    expect(recordedEvents().map((event) => event.eventName)).toEqual(
      expect.arrayContaining([
        "background-agent.workflow.started",
        "background-agent.github.installation.resolved",
        "background-agent.sandbox.started",
        "background-agent.git.context.started",
        "background-agent.git.context.completed",
        "background-agent.agent.started",
        "background-agent.agent.step.completed",
        "background-agent.agent.completed",
        "background-agent.check.completed",
        "background-agent.run.completed",
      ]),
    );
    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "skipped",
      summary: "No check command configured.",
    });
    expect(recordedStatusUpdates().map((update) => update.status)).toEqual([
      "running",
      "succeeded",
    ]);

    // Comment-only agent has no write action enabled — no working branch
    // prep git checkout should have run.
    expect(
      sandboxExec.mock.calls.some(([command]) =>
        (command as string).includes("git checkout"),
      ),
    ).toBe(false);
  });

  test("requires write permission when open_pull_request is enabled", async () => {
    currentAgent = buildAgent({
      githubActions: { open_pull_request: true },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "write",
    });
  });

  test("prepares a working branch and passes it to the prompt when a write action is enabled", async () => {
    currentAgent = buildAgent({
      githubActions: { open_pull_request: true, push: true },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(
      sandboxExec.mock.calls.some(([command]) =>
        (command as string).includes("git checkout"),
      ),
    ).toBe(true);
    expect(recordedEvent("background-agent.git.branch.resolved")).toMatchObject(
      {
        status: "succeeded",
        payload: {
          branchName: "background-agent/smoke-fixer/run_12345678",
        },
      },
    );

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      messages?: Array<{ content?: string }>;
    };
    const promptContent = call?.messages?.[0]?.content ?? "";
    expect(promptContent).toContain(
      "background-agent/smoke-fixer/run_12345678",
    );
    expect(promptContent).toContain("github_push");
    expect(promptContent).toContain("github_open_pull_request");
  });

  test("stops before checks when the agent loop throws", async () => {
    generate.mockImplementationOnce(async () => {
      throw new Error("agent loop exploded");
    });
    currentAgent = buildAgent({ checkCommand: "bun test" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "workflow_failed",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "workflow_failed",
    });
  });

  test("stops at checks_failed when the required check command fails", async () => {
    currentAgent = buildAgent({ checkCommand: "bun test" });
    commandResults.set("bun test", {
      success: false,
      stdout: "",
      stderr: "tests failed",
      exitCode: 1,
      truncated: false,
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "failed",
      errorKind: "checks_failed",
    });
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "checks_failed",
      summary: "Required background-agent check failed.",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "checks_failed",
    });
  });

  test("succeeds after checks pass and sets outputUrl from the newest created output", async () => {
    currentAgent = buildAgent({ checkCommand: "bun test" });
    // Simulate the agent loop calling github_open_pull_request, which
    // records an output row via recordBackgroundAgentOutput before the
    // executor reaches its terminal success path.
    generate.mockImplementationOnce(async () => {
      await recordBackgroundAgentOutput({
        runId: currentRun.id,
        userId: currentRun.userId,
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
        prNumber: 42,
      });
      return {
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { messages: [] },
        steps: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "succeeded",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
      outputUrl: "https://github.com/acme/widgets/pull/42",
    });
  });

  test("runs unattended and forwards the agent's builtinToolNames allowlist", async () => {
    currentAgent = buildAgent({
      builtinToolNames: ["read", "grep", "bash"],
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { unattended?: boolean; allowedBuiltinToolNames?: string[] };
    };
    expect(call?.options?.unattended).toBe(true);
    expect(call?.options?.allowedBuiltinToolNames).toEqual([
      "read",
      "grep",
      "bash",
    ]);
  });

  test("defaults builtinToolNames to null (no restriction) when the agent has none", async () => {
    currentAgent = buildAgent();
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { allowedBuiltinToolNames?: unknown };
    };
    expect(call?.options?.allowedBuiltinToolNames).toBeNull();
  });

  test("injects only the enabled native GitHub action tools", async () => {
    currentAgent = buildAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      tools?: Record<string, unknown>;
    };
    expect(call?.tools?.github_comment_on_pr_or_issue).toBeDefined();
    expect(call?.tools?.github_open_pull_request).toBeUndefined();
    expect(call?.tools?.github_push).toBeUndefined();
  });

  test("records the resolved model id on usage events instead of the literal 'ai/background-agent'", async () => {
    currentAgent = buildAgent({ modelId: "anthropic/claude-haiku-4.5" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        source: "background-agent",
        model: "anthropic/claude-haiku-4.5",
      }),
    );

    const startedEvent = recordedEvent("background-agent.agent.started");
    expect(startedEvent?.payload).toMatchObject({
      modelId: "anthropic/claude-haiku-4.5",
    });
  });

  test("records the default model id on usage events when the agent has no modelId", async () => {
    currentAgent = buildAgent({ modelId: null });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        model: "anthropic/claude-opus-4.6",
      }),
    );
  });
});
