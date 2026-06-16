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

type OpenPullRequestInput = {
  repoUrl: string;
  branchName: string;
  title: string;
  body: string;
  baseBranch: string;
  token: string;
};

const successfulAccess = {
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
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

const getBackgroundAgentRunWithAgent = mock(async () => ({
  run: currentRun,
  agent: currentAgent,
}));
const recordBackgroundAgentEvent = mock(async (input: EventInput) => input);
const recordBackgroundAgentOutput = mock(async (input: OutputInput) => input);
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
const openPullRequest = mock(async (_input: OpenPullRequestInput) => ({
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/42",
  prNumber: 42,
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
const listBackgroundAgentOutputs = mock(async () => []);

mock.module("./store", () => ({
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
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
  openAgent: {
    generate,
  },
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
    outputKind: "none",
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
  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
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
  getGitHubAppUserToken.mockClear();
  getGitHubUserProfile.mockClear();
  generate.mockClear();
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
  test("starts a resumable sandbox and records skipped check evidence", async () => {
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

    expect(recordedEvents().map((event) => event.eventName)).toEqual(
      expect.arrayContaining([
        "background-agent.workflow.started",
        "background-agent.github.installation.resolved",
        "background-agent.sandbox.started",
        "background-agent.git.context.started",
        "background-agent.git.context.completed",
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
  });

  test("stops before ready PR creation when required checks fail", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
    });
    currentRun = buildRun({
      outputKind: "ready_pr",
    });
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
    expect(hasUncommittedChanges).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(openPullRequest).not.toHaveBeenCalled();
    expect(recordBackgroundAgentOutput).not.toHaveBeenCalled();
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "checks_failed",
    });
  });

  test("creates a ready PR output only after checks pass", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
    });
    currentRun = buildRun({
      outputKind: "ready_pr",
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "succeeded",
    });
    expect(stageAll).toHaveBeenCalledWith(fakeSandbox);
    expect(buildCommitIntentFromSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        branch: "background-agent/smoke-fixer/run_12345678",
        baseBranch: "main",
      }),
    );
    expect(createCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        branch: "background-agent/smoke-fixer/run_12345678",
      }),
    );

    const prCall = openPullRequest.mock.calls[0]?.[0] as
      | OpenPullRequestInput
      | undefined;
    expect(prCall).toMatchObject({
      repoUrl: "https://github.com/acme/widgets",
      branchName: "background-agent/smoke-fixer/run_12345678",
      baseBranch: "main",
      token: "user-token",
    });
    expect(prCall?.body).toContain(
      "https://open-agents.example/background-runs/run_1234567890abcdef",
    );
    expect(recordBackgroundAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run_1234567890abcdef",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
        prNumber: 42,
      }),
    );
    expect(recordedEvent("background-agent.output.created")).toMatchObject({
      status: "succeeded",
      payload: expect.objectContaining({
        outputKind: "ready_pr",
        prNumber: 42,
      }),
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
      outputUrl: "https://github.com/acme/widgets/pull/42",
    });
  });
});
