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
process.env.BACKGROUND_AGENTS_ENABLED = "true";
process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";

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
  async (input: StatusUpdateInput): Promise<BackgroundAgentRun> => {
    currentRun = {
      ...currentRun,
      status: input.status,
      workflowRunId: input.workflowRunId ?? currentRun.workflowRunId,
      sandboxName: input.sandboxName ?? currentRun.sandboxName,
      errorKind: input.errorKind ?? currentRun.errorKind,
      errorMessage: input.errorMessage ?? currentRun.errorMessage,
      outputUrl: input.outputUrl ?? currentRun.outputUrl,
    };
    return currentRun;
  },
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

type MockToolCall = {
  type: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};
type MockGenerateResult = {
  finishReason: string;
  rawFinishReason: string;
  response: { messages: unknown[] };
  steps: Array<{ toolCalls: MockToolCall[] }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

const TOOL_CALLS_RESULT: MockGenerateResult = {
  finishReason: "tool-calls",
  rawFinishReason: "tool_use",
  response: { messages: [] },
  steps: [],
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  totalUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
};
const STOP_RESULT: MockGenerateResult = {
  finishReason: "stop",
  rawFinishReason: "stop",
  response: { messages: [] },
  steps: [],
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  totalUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
};

const generate = mock(async (): Promise<MockGenerateResult> => STOP_RESULT);

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
  toProviderModelId: (modelId: string) => modelId,
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
  assertInferenceProfileRouteAvailable: mock(async () => undefined),
  resolveInferenceProfileModelSelection: mock(
    async (params: { selection: unknown }) => params.selection,
  ),
}));

const executorModulePromise = import("./executor");
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalMaxTurns = process.env.BACKGROUND_AGENT_MAX_TURNS;
const originalMaxStaleTurns = process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
const originalRepetitionThreshold =
  process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD;
const originalStallGraceTurns = process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS;
const originalStallFinalizeTurns =
  process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
const originalMaxRunTokens = process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS;

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
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
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
  if (originalRepetitionThreshold === undefined) {
    delete process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD;
  } else {
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD =
      originalRepetitionThreshold;
  }
  if (originalStallGraceTurns === undefined) {
    delete process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS;
  } else {
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = originalStallGraceTurns;
  }
  if (originalStallFinalizeTurns === undefined) {
    delete process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
  } else {
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS =
      originalStallFinalizeTurns;
  }
  if (originalMaxRunTokens === undefined) {
    delete process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS;
  } else {
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = originalMaxRunTokens;
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

  // (#916) A stall no longer hard-kills the run at the stale-turn cap — it
  // nudges, then (after the grace window) escalates to a finalize
  // instruction, then terminates with errorKind agent_stalled only once the
  // finalize window elapses without recovery.
  test("a frozen working tree escalates past the stale-turn cap and terminates as agent_stalled", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "5";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "2";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "2";
    gitProbeMode = "frozen";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Turn 5: stale-turn cap first reached -> nudge. Turns 6-7: grace (2) ->
    // escalate on turn 7. Turns 8-9: finalize window (2) -> terminate on 9.
    expect(
      recordedEvent("background-agent.progress.nudge_issued"),
    ).toMatchObject({
      level: "info",
      payload: {
        trigger: "git_stale",
        staleTurns: 5,
        capability: "push_or_pr",
      },
    });
    expect(recordedEvent("background-agent.progress.escalated")).toMatchObject({
      level: "warn",
      payload: {
        trigger: "git_stale",
        staleTurns: 7,
        capability: "push_or_pr",
      },
    });
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "agent_stalled",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "agent_stalled",
    });
    expect(generate.mock.calls.length).toBe(9);
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

describe("high token backstop fuse (#917)", () => {
  test("breach escalates with trigger token_fuse and terminates as token_budget_exceeded", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "50";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "1";
    gitProbeMode = "changing";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.progress.token_fuse")).toMatchObject(
      {
        level: "warn",
        payload: {
          ceiling: 50,
        },
      },
    );
    const fuseEvent = recordedEvent("background-agent.progress.token_fuse");
    expect(
      (fuseEvent?.payload as { accumulatedTokens?: number })?.accumulatedTokens,
    ).toBeGreaterThanOrEqual(50);

    expect(recordedEvent("background-agent.progress.escalated")).toMatchObject({
      payload: { trigger: "token_fuse" },
    });
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "token_budget_exceeded",
      payload: { trigger: "token_fuse" },
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "token_budget_exceeded",
    });
    expect(generate.mock.calls.length).toBe(4);
  });

  test("a run just under the ceiling completes normally", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "1000000";
    gitProbeMode = "changing";
    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      return step >= 3 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(
      recordedEvent("background-agent.progress.token_fuse"),
    ).toBeUndefined();
    expect(recordedEvent("background-agent.run.failed")).toBeUndefined();
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
  });
});

describe("action-repetition / cycle detection (#915)", () => {
  // (#916) Repetition-driven stall also escalates rather than hard-killing:
  // nudge on first detection, escalate after the grace window, terminate as
  // agent_stalled (trigger "repetition") after the finalize window.
  test("a repeated tool-call turn feeds the stall verdict, escalates, and terminates as agent_stalled (trigger repetition)", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "4";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "1";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "1";
    gitProbeMode = "changing";

    const REPEATED_TOOL_CALLS_RESULT = {
      ...TOOL_CALLS_RESULT,
      steps: [
        {
          toolCalls: [
            {
              type: "tool-call",
              toolCallId: "t",
              toolName: "bash",
              input: { command: "bun test" },
            },
          ],
        },
      ],
    };
    generate.mockImplementation(async () => REPEATED_TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Turn 4: repetition first detected -> nudge. Turn 5: grace (1) ->
    // escalate. Turn 6: finalize window (1) -> terminate.
    expect(generate.mock.calls.length).toBe(6);

    const repetitionEvent = recordedEvent(
      "background-agent.progress.repetition_detected",
    );
    expect(repetitionEvent).toBeTruthy();
    expect(repetitionEvent).toMatchObject({ level: "warn" });
    const payload = repetitionEvent?.payload as {
      toolName?: string;
      repeatCount?: number;
      cycleLength?: number | null;
    };
    expect(payload.toolName).toBe("bash");
    expect(payload.repeatCount).toBe(4);
    expect(payload.cycleLength).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("bun test");

    expect(
      recordedEvent("background-agent.progress.nudge_issued"),
    ).toMatchObject({ payload: { trigger: "repetition" } });
    expect(recordedEvent("background-agent.progress.escalated")).toMatchObject({
      payload: { trigger: "repetition" },
    });
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "agent_stalled",
      payload: { trigger: "repetition", nudgeIssued: true },
    });
  });

  test("repeated check command interleaved with distinct edits stays green (false-positive guard)", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "3";
    gitProbeMode = "changing";

    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      if (step > 3) {
        return STOP_RESULT;
      }
      return {
        ...TOOL_CALLS_RESULT,
        steps: [
          {
            toolCalls: [
              {
                type: "tool-call",
                toolCallId: `edit-${step}`,
                toolName: "edit_file",
                input: { path: `file-${step}.ts`, content: `content-${step}` },
              },
              {
                type: "tool-call",
                toolCallId: `test-${step}`,
                toolName: "bash",
                input: { command: "bun test" },
              },
            ],
          },
        ],
      };
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(
      recordedEvent("background-agent.progress.repetition_detected"),
    ).toBeUndefined();
    expect(recordedEvent("background-agent.run.failed")).toBeUndefined();
    expect(recordedEvent("background-agent.agent.completed")).toBeTruthy();
  });
});

describe("escalate-and-commit on stall (#916)", () => {
  function injectedNoteAtCall(calls: unknown[][], index: number): string {
    const call = calls[index];
    const input = call?.[0] as
      | { messages?: Array<{ content?: unknown }> }
      | undefined;
    const messages = input?.messages ?? [];
    const lastMessage = messages.at(-1);
    return typeof lastMessage?.content === "string" ? lastMessage.content : "";
  }

  test("the turn after a first-detected stall carries the re-plan nudge note", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "5";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "5";
    gitProbeMode = "frozen";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Turn 3 first hits the stale cap and triggers a nudge; turn 4's prompt
    // carries the ephemeral re-plan note.
    const noteOnTurnFour = injectedNoteAtCall(generate.mock.calls, 3);
    expect(noteOnTurnFour.toLowerCase()).toContain("re-plan");
  });

  test("the turn after the grace window carries the tool-aware finalize instruction (push+PR agent)", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "1";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "5";
    currentAgent = buildAgent({
      githubActions: { open_pull_request: true, push: true },
    });
    gitProbeMode = "frozen";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Turn 3: nudge. Turn 4: grace(1) elapses -> escalate. Turn 5's prompt
    // carries the finalize instruction.
    const noteOnTurnFive = injectedNoteAtCall(generate.mock.calls, 4);
    expect(noteOnTurnFive.toLowerCase()).toContain("commit and push");
    expect(noteOnTurnFive.toLowerCase()).toContain("open");
    expect(noteOnTurnFive).toContain("what you attempted");
  });

  test("the finalize instruction for a comment-only agent has no push/pull-request language", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "1";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "5";
    currentAgent = buildAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    gitProbeMode = "frozen";
    generate.mockImplementation(async () => TOOL_CALLS_RESULT);

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const noteOnTurnFive = injectedNoteAtCall(generate.mock.calls, 4);
    expect(noteOnTurnFive.toLowerCase()).not.toContain("push");
    expect(noteOnTurnFive.toLowerCase()).not.toContain("pull request");
    expect(noteOnTurnFive.toLowerCase()).toContain("comment");
    expect(noteOnTurnFive).toContain("what you attempted");
  });

  test("a natural stop (agent stops issuing tool calls) while escalating terminates as agent_stalled instead of succeeding", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "1";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "5";
    gitProbeMode = "frozen";
    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      // Turns 1-2: tool-calls (building the stale streak). Turn 3: stale cap
      // hit -> nudge. Turn 4: grace(1) elapses -> escalate. Turn 5: the
      // agent, given the finalize instruction, stops naturally after
      // (presumably) committing/commenting via its own tool calls in this
      // same turn's response.
      return step >= 5 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(recordedEvent("background-agent.agent.completed")).toBeUndefined();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "agent_stalled",
    });
    expect(generate.mock.calls.length).toBe(5);
  });

  test("recovers without failing when the git tree starts changing again after a nudge", async () => {
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "3";
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "2";
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "2";
    gitProbeMode = "frozen";

    let step = 0;
    generate.mockImplementation(async () => {
      step += 1;
      // Turns 1-3 frozen (stale cap hit at turn 3 -> nudge). Turn 4 onward:
      // flip to a changing tree, recovering before escalation, then stop.
      if (step === 4) {
        gitProbeMode = "changing";
      }
      return step >= 6 ? STOP_RESULT : TOOL_CALLS_RESULT;
    });

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(
      recordedEvent("background-agent.progress.escalated"),
    ).toBeUndefined();
    expect(recordedEvent("background-agent.run.failed")).toBeUndefined();
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
  });
});
