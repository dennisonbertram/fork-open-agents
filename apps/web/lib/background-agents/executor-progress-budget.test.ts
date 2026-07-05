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
    source: { repo: string; branch: string };
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
let recordedOutputs: OutputRow[] = [];
let outputIdCounter = 0;

// Toggles the git-progress-probe response for the tests in this file. The
// probe command is distinguished by the OA_PROGRESS_PROBE marker baked into
// its literal text in executor.ts.
let gitProbeMode: "frozen" | "changing" = "frozen";
let gitProbeCallCount = 0;

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
  if (command.includes("OA_PROGRESS_PROBE")) {
    gitProbeCallCount += 1;
    return {
      success: true,
      stdout:
        gitProbeMode === "changing"
          ? `probe-state-${gitProbeCallCount}`
          : "frozen-probe-state",
      stderr: "",
      exitCode: 0,
      truncated: false,
    };
  }
  if (command.includes("git checkout")) {
    return successfulCommand;
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
    files: [{ path: "README.md", content: "Updated", mode: "100644" }],
    coAuthor: { name: "mona", email: "1+mona@users.noreply.github.com" },
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

const TOOL_CALLS_RESULT = {
  finishReason: "tool-calls",
  rawFinishReason: "tool_use",
  response: { messages: [] },
  steps: [],
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  totalUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
};
const STOP_RESULT = {
  finishReason: "stop",
  rawFinishReason: "stop",
  response: { messages: [] },
  steps: [],
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  totalUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
};

const generate = mock(async () => STOP_RESULT);

const listBackgroundAgentEvents = mock(async () => []);
const listBackgroundAgentComposioEvents = mock(async () => []);
const recordUsage = mock(async () => undefined);

mock.module("./store", () => ({
  seedTriggerNextRunAt: async () => undefined,
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentComposioEvents,
  listBackgroundAgentOutputs: listBackgroundAgentOutputsMock,
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
    warnings: [],
  })),
  mergeEventsForSummary: mock((capped: unknown[], composio: unknown[]) => [
    ...capped,
    ...composio,
  ]),
}));

mock.module("./run-summary-persist", () => ({
  persistRunSummary: mock(async () => undefined),
  recordSummaryFailedEvent: mock(async () => undefined),
}));

mock.module("@/lib/db/usage", () => ({ recordUsage }));

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

mock.module("@/lib/github/commit", () => ({ buildCoAuthor, createCommit }));

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

mock.module("@/lib/github/token", () => ({ getGitHubAppUserToken }));

mock.module("@/lib/github/users", () => ({ getGitHubUserProfile }));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: (modelId: string) => modelId,
  defaultModelLabel: "anthropic/claude-opus-4.6",
  openAgent: { generate },
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
const originalMaxTurns = process.env.BACKGROUND_AGENT_MAX_TURNS;
const originalMaxStaleTurns = process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;

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
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: { title: "Fix widgets", actor: "mona" },
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
    runBudgetPerTarget: 10,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function recordedEvents() {
  return recordBackgroundAgentEvent.mock.calls.map(([input]) => input);
}

function recordedEvent(name: string) {
  return recordedEvents().find((event) => event.eventName === name);
}

function recordedStatusUpdates() {
  return updateBackgroundAgentRunStatus.mock.calls.map(([input]) => input);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  recordedOutputs = [];
  outputIdCounter = 0;
  gitProbeMode = "frozen";
  gitProbeCallCount = 0;
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
  generate.mockImplementation(async () => STOP_RESULT);
  recordUsage.mockClear();
});

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
  if (originalMaxTurns === undefined) {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
  } else {
    process.env.BACKGROUND_AGENT_MAX_TURNS = originalMaxTurns;
  }
  if (originalMaxStaleTurns === undefined) {
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
  } else {
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = originalMaxStaleTurns;
  }
});

afterAll(() => {
  mock.restore();
});

describe("no-progress (git-delta) turn budget (#914)", () => {
  test("a run that changes the git tree every turn is never killed by a total-turn cap", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    gitProbeMode = "changing";

    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      return step >= 31 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.run.failed")).toBeUndefined();
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
    expect(generate.mock.calls.length).toBe(31);
  });

  test("a frozen working tree stalls at exactly the configured stale-turn cap", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "5";
    gitProbeMode = "frozen";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "agent_turn_budget_exceeded",
    });
    expect(generate.mock.calls.length).toBe(5);
  });

  test("emits background-agent.progress.observed once per continuing turn, hashing the fingerprint", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    gitProbeMode = "changing";
    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      return step >= 4 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const observedEvents = recordedEvents().filter(
      (event) => event.eventName === "background-agent.progress.observed",
    );
    expect(observedEvents.length).toBeGreaterThan(0);
    for (const event of observedEvents) {
      const payload = event.payload as {
        gitFingerprint?: string;
        changed?: boolean;
        staleTurns?: number;
        step?: number;
      };
      expect(typeof payload.gitFingerprint).toBe("string");
      expect(payload.gitFingerprint).not.toContain("probe-state");
      expect(typeof payload.step).toBe("number");
      expect(typeof payload.changed).toBe("boolean");
      expect(typeof payload.staleTurns).toBe("number");
    }
  });

  test("records background-agent.agent.step.completed exactly once per turn on a productive run", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    gitProbeMode = "changing";
    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      return step >= 6 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const completedEvents = recordedEvents().filter(
      (event) => event.eventName === "background-agent.agent.step.completed",
    );
    expect(completedEvents.length).toBe(6);
  });

  test("BACKGROUND_AGENT_MAX_TURNS, when set, still enforces an absolute hard ceiling", async () => {
    process.env.BACKGROUND_AGENT_MAX_TURNS = "3";
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    gitProbeMode = "changing";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "agent_turn_budget_exceeded",
    });
    expect(generate.mock.calls.length).toBe(3);
  });
});
