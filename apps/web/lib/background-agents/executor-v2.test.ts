/**
 * #746 — Executor v2 checklist tests (a)-(e):
 *
 * (a) agent with only comment toggle → openAgent.generate (mocked) receives
 *     only github_comment_on_pr_or_issue + builtins.
 * (b) required-permission derivation per toggle set.
 * (c) model resolution passes options.model and recordUsage gets the real id
 *     — including the failure path (fails the run, no silent fallback).
 * (d) denial event emitted when the sanitizer rewrites messages.
 * (e) ready_pr-equivalent flow: agent with push+open_pr toggles → tools
 *     called → outputs rows (mocked octokit).
 */
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
import {
  buildBackgroundAgentExecutionSnapshot,
  hashBackgroundAgentExecutionSnapshot,
} from "./execution-snapshot";
import * as normalizedRuntime from "@/lib/unattended-runtime/normalized-step-input";

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
  expectedStatuses?: BackgroundAgentRun["status"][];
  force?: boolean;
};

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
let accessUserPermission: "read" | "write" = "write";
let accessRequiredPermissionSeen: string[] = [];
let beforeStatusUpdate:
  | ((input: StatusUpdateInput) => void | Promise<void>)
  | null = null;
let afterEventRecorded: ((input: EventInput) => void | Promise<void>) | null =
  null;

const getBackgroundAgentRunWithAgent = mock(async () => ({
  run: currentRun,
  agent: currentAgent,
}));
const recordBackgroundAgentEvent = mock(async (input: EventInput) => {
  await afterEventRecorded?.(input);
  return input;
});
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
  async (input: StatusUpdateInput): Promise<BackgroundAgentRun | null> => {
    const hook = beforeStatusUpdate;
    beforeStatusUpdate = null;
    await hook?.(input);

    const terminalStatuses: BackgroundAgentRun["status"][] = [
      "succeeded",
      "failed",
      "skipped",
      "cancelled",
    ];
    if (!input.force && terminalStatuses.includes(currentRun.status)) {
      return null;
    }
    if (
      input.expectedStatuses &&
      !input.expectedStatuses.includes(currentRun.status)
    ) {
      return null;
    }

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
const listBackgroundAgentEvents = mock(async () => []);
// #798 P2-1: uncapped, composio-scoped fetch — default empty so existing
// tests (which never assert on the merge) are unaffected.
const listBackgroundAgentComposioEvents = mock(async () => []);

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

const persistRunSummary = mock(async () => undefined);
const recordSummaryFailedEvent = mock(async () => undefined);
mock.module("./run-summary-persist", () => ({
  persistRunSummary,
  recordSummaryFailedEvent,
}));

const recordUsage = mock(async () => undefined);
mock.module("@/lib/db/usage", () => ({
  recordUsage,
}));

const sandboxExec = mock(
  async (_command: string): Promise<ExecResult> => successfulCommand,
);
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

let afterSandboxConnected: (() => void | Promise<void>) | null = null;
const connectSandbox = mock(async (_input: unknown) => {
  await afterSandboxConnected?.();
  return fakeSandbox;
});
mock.module("@open-agents/sandbox", () => ({
  connectSandbox,
  getCurrentBranch: mock(async () => "main"),
  getStagedDiff: mock(async () => "diff content"),
  hasUncommittedChanges: mock(async () => true),
  stageAll: mock(async () => undefined),
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: "snapshot-test",
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

const verifyRepoAccess = mock(
  async (params: { requiredUserPermission?: string }) => {
    accessRequiredPermissionSeen.push(params.requiredUserPermission ?? "read");
    return {
      ok: true,
      installationId: 99,
      repositoryId: 42,
      defaultBranch: "main",
      userPermission: accessUserPermission,
    } as const;
  },
);
const getRepoAccessErrorMessage = mock((reason: string) => reason);
mock.module("@/lib/github/access", () => ({
  verifyRepoAccess,
  getRepoAccessErrorMessage,
}));

const mintInstallationToken = mock(async () => ({ token: "setup-token" }));
const revokeInstallationToken = mock(async () => undefined);
const withScopedInstallationOctokit = mock(
  async (params: {
    operation: (octokit: unknown) => Promise<unknown>;
  }): Promise<unknown> => params.operation({ rest: { issues: {}, pulls: {} } }),
);
mock.module("@/lib/github/app", () => ({
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
}));

mock.module("@/lib/github/commit", () => ({
  buildCoAuthor: mock(async () => null),
  createCommit: mock(async () => ({ ok: true, commitSha: "sha-1" })),
}));
mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: mock(async () => ({
    ok: true,
    intent: {
      owner: "acme",
      repo: "widgets",
      repositoryId: 42,
      installationId: 99,
      branch: "background-agent/e2e-agent/run_1234abcd",
      baseBranch: "main",
      expectedHeadSha: "base-sha",
      message: "chore: apply changes",
      files: [{ path: "README.md", content: "Updated", mode: "100644" }],
      coAuthor: null,
    },
  })),
}));

// Mocked octokit-backed GitHub write calls used by the native action tools.
const openPullRequest = mock(async () => ({
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/55",
  prNumber: 55,
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
mock.module("@/lib/github/pulls", () => ({
  openPullRequest,
  mergePullRequest,
  submitPullRequestReview,
  deleteBranchRef,
  getMergeReadinessViaInstallation,
}));

mock.module("@/lib/github/token", () => ({
  getGitHubAppUserToken: mock(async () => "user-token"),
}));
mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: mock(async () => ({
    username: "mona",
    externalUserId: "1",
  })),
}));

type LearningsRunnerParams = {
  assertLiveAuthorization?: () => Promise<void>;
};
let learningsRunImpl: (
  params: LearningsRunnerParams,
) => Promise<Record<string, unknown>> = async () => ({
  candidatesExtracted: 0,
  accepted: 0,
  merged: 0,
  rejected: 0,
});
const runLearningsExtraction = mock((params: LearningsRunnerParams) =>
  learningsRunImpl(params),
);
mock.module("@/lib/learnings/runner", () => ({ runLearningsExtraction }));
mock.module("@/lib/learnings/store", () => ({
  createDbLearningsStore: mock(() => ({})),
}));

const resolveComposioToolsForBgRun = mock(async () => ({
  status: "off" as const,
  reason: "no_slugs_selected" as const,
}));
mock.module("./composio-tools", () => ({
  assertComposioRepoToolkitsStillAllowed: mock(async () => undefined),
  resolveComposioToolsForBgRun,
}));

type NormalizedSandboxBuilderInput = Parameters<
  typeof normalizedRuntime.buildNormalizedBackgroundSandboxInput
>[0];
type NormalizedSandboxInput = ReturnType<
  typeof normalizedRuntime.buildNormalizedBackgroundSandboxInput
>;
type NormalizedLearningsBuilderInput = Parameters<
  typeof normalizedRuntime.buildNormalizedBackgroundLearningsInput
>[0];
const realBuildNormalizedBackgroundSandboxInput =
  normalizedRuntime.buildNormalizedBackgroundSandboxInput;
const realBuildNormalizedBackgroundLearningsInput =
  normalizedRuntime.buildNormalizedBackgroundLearningsInput;

let normalizedSandboxImpl = (
  input: NormalizedSandboxBuilderInput,
): NormalizedSandboxInput => realBuildNormalizedBackgroundSandboxInput(input);
let normalizedLearningsImpl = (input: NormalizedLearningsBuilderInput) =>
  realBuildNormalizedBackgroundLearningsInput(input);
const buildNormalizedBackgroundSandboxInput = mock(
  (input: NormalizedSandboxBuilderInput) => {
    const result = normalizedSandboxImpl(input);
    normalizedSandboxOutputs.push(result);
    return result;
  },
);
const buildNormalizedBackgroundLearningsInput = mock(
  (input: NormalizedLearningsBuilderInput) => normalizedLearningsImpl(input),
);

mock.module("@/lib/unattended-runtime/normalized-step-input", () => ({
  ...normalizedRuntime,
  buildNormalizedBackgroundSandboxInput,
  buildNormalizedBackgroundLearningsInput,
}));

const normalizedSandboxOutputs: NormalizedSandboxInput[] = [];

// ---------------------------------------------------------------------------
// sanitizeUnattendedToolCalls — real-ish fake honoring the documented
// contract: returns the SAME reference when nothing needed fixing, or a NEW
// array with injected execution-denied tool-result messages otherwise.
// ---------------------------------------------------------------------------
let sanitizerShouldDeny: { toolCallId: string; toolName: string } | null = null;

function fakeSanitizeUnattendedToolCalls(messages: unknown[]): unknown[] {
  if (!sanitizerShouldDeny) {
    return messages;
  }
  const denied = sanitizerShouldDeny;
  sanitizerShouldDeny = null; // only inject once
  return [
    ...messages,
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: denied.toolCallId,
          toolName: denied.toolName,
          output: { type: "execution-denied", reason: "denied for test" },
        },
      ],
    },
  ];
}

type GenerateCall = {
  messages: unknown[];
  options: {
    customInstructions?: string;
    runtimeMode?: string;
    sandbox?: unknown;
    model?: unknown;
    allowedBuiltinToolNames?: string[] | null;
  };
  tools?: Record<string, unknown>;
  timeout?: unknown;
};
const generateCalls: GenerateCall[] = [];
let generateImpl: (input: GenerateCall) => Promise<unknown> = async () => ({
  finishReason: "stop",
  rawFinishReason: "stop",
  response: { messages: [] },
  steps: [],
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
});
const generate = mock(async (input: GenerateCall) => {
  generateCalls.push(input);
  return generateImpl(input);
});

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: fakeSanitizeUnattendedToolCalls,
  gateway: (modelId: string) => modelId,
  defaultModelLabel: "anthropic/claude-opus-4.6",
  openAgent: { generate },
}));

let inferenceProfileResolutionShouldFail = false;
let inferenceRouteAvailabilityFailureAt: number | null = null;
let inferenceRouteAvailabilityCalls = 0;
const inferenceResolutionCalls: Array<Record<string, unknown>> = [];
mock.module("@/lib/inference/model-option-id", () => ({
  USER_INFERENCE_OPTION_PREFIX: "user-profile:",
  parseModelOptionSelection: (optionId: string) => {
    if (optionId.startsWith("user-profile:")) {
      const rest = optionId.slice("user-profile:".length);
      const [profileId, modelId] = rest.split(":");
      return { modelId, inferenceProfileId: profileId ?? null };
    }
    return { modelId: optionId, inferenceProfileId: null };
  },
  getModelOptionSelectionId: (modelId: string | null | undefined) =>
    modelId ?? "",
}));
mock.module("@/lib/inference/profile-resolution", () => ({
  assertInferenceProfileRouteAvailable: mock(async () => {
    inferenceRouteAvailabilityCalls += 1;
    if (
      inferenceRouteAvailabilityFailureAt !== null &&
      inferenceRouteAvailabilityCalls >= inferenceRouteAvailabilityFailureAt
    ) {
      throw new Error("Selected inference profile changed after queueing.");
    }
  }),
  resolveInferenceProfileModelSelection: mock(
    async (params: { selection: unknown } & Record<string, unknown>) => {
      inferenceResolutionCalls.push(params);
      if (inferenceProfileResolutionShouldFail) {
        throw new Error(
          "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
        );
      }
      return params.selection;
    },
  ),
}));

const executorModulePromise = import("./executor");
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

function buildRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "run_v2_1234abcd",
    agentId: "agent-v2",
    triggerId: "trigger-v2",
    userId: "user-v2",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-v2",
    idempotencyKey: "idempotency-v2",
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
    requestId: "req-v2",
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
    id: "agent-v2",
    userId: "user-v2",
    name: "E2E agent",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Do the thing.",
    permissions: {},
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: { comment_on_pr_or_issue: true },
    runBudgetPerTarget: 10,
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    modelId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildSnapshotRun(
  acceptedAgent: BackgroundAgent,
  overrides: Record<string, unknown> = {},
): BackgroundAgentRun {
  const executionSnapshot =
    (overrides.executionSnapshot as ReturnType<
      typeof buildBackgroundAgentExecutionSnapshot
    >) ?? buildBackgroundAgentExecutionSnapshot(acceptedAgent);
  return buildRun({
    ...({
      executionSnapshot,
      definitionVersion: 1,
      definitionHash: hashBackgroundAgentExecutionSnapshot(executionSnapshot),
      ...overrides,
    } as unknown as Partial<BackgroundAgentRun>),
  });
}

function recordedEvents() {
  return recordBackgroundAgentEvent.mock.calls.map(([input]) => input);
}

function recordedEvent(name: string) {
  return recordedEvents().find((event) => event.eventName === name);
}

function recordedEventsNamed(name: string) {
  return recordedEvents().filter((event) => event.eventName === name);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  recordedOutputs = [];
  outputIdCounter = 0;
  accessUserPermission = "write";
  accessRequiredPermissionSeen = [];
  beforeStatusUpdate = null;
  afterEventRecorded = null;
  afterSandboxConnected = null;
  sanitizerShouldDeny = null;
  inferenceProfileResolutionShouldFail = false;
  inferenceRouteAvailabilityFailureAt = null;
  inferenceRouteAvailabilityCalls = 0;
  inferenceResolutionCalls.length = 0;
  generateCalls.length = 0;
  generateImpl = async () => ({
    finishReason: "stop",
    rawFinishReason: "stop",
    response: { messages: [] },
    steps: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
  learningsRunImpl = async () => ({
    candidatesExtracted: 0,
    accepted: 0,
    merged: 0,
    rejected: 0,
  });

  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  listBackgroundAgentOutputsMock.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  persistRunSummary.mockClear();
  recordSummaryFailedEvent.mockClear();
  sandboxExec.mockClear();
  connectSandbox.mockClear();
  verifyRepoAccess.mockClear();
  mintInstallationToken.mockClear();
  revokeInstallationToken.mockClear();
  withScopedInstallationOctokit.mockClear();
  openPullRequest.mockClear();
  mergePullRequest.mockClear();
  submitPullRequestReview.mockClear();
  deleteBranchRef.mockClear();
  getMergeReadinessViaInstallation.mockClear();
  generate.mockClear();
  recordUsage.mockClear();
  runLearningsExtraction.mockClear();
  resolveComposioToolsForBgRun.mockClear();
  normalizedSandboxImpl = (input) =>
    realBuildNormalizedBackgroundSandboxInput(input);
  normalizedLearningsImpl = (input) =>
    realBuildNormalizedBackgroundLearningsInput(input);
  buildNormalizedBackgroundSandboxInput.mockClear();
  buildNormalizedBackgroundLearningsInput.mockClear();
  normalizedSandboxOutputs.length = 0;
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

describe("(a) comment-only agent toolset", () => {
  test("agent with only comment toggle receives only github_comment_on_pr_or_issue plus builtins", async () => {
    currentAgent = buildAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const call = generateCalls[0];
    const toolNames = Object.keys(call?.tools ?? {});
    expect(toolNames).toEqual(["github_comment_on_pr_or_issue"]);
  });
});

describe("execution snapshot binding", () => {
  test("a lost terminal-success CAS emits no completion evidence", async () => {
    afterEventRecorded = (event) => {
      if (event.eventName === "background-agent.check.completed") {
        beforeStatusUpdate = (input) => {
          if (input.status === "succeeded") {
            currentRun = { ...currentRun, status: "cancelled" };
          }
        };
      }
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-success-race",
    });

    expect(currentRun.status).toBe("cancelled");
    expect(recordedEvent("background-agent.run.completed")).toBeUndefined();
  });

  test("rechecks live authorization before sandbox connection", async () => {
    afterEventRecorded = (event) => {
      if (event.eventName === "background-agent.github.installation.resolved") {
        currentAgent = currentAgent
          ? { ...currentAgent, status: "disabled" }
          : null;
      }
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-before-sandbox",
    });

    expect(connectSandbox).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("rechecks live authorization after sandbox connection before mutation", async () => {
    afterSandboxConnected = () => {
      currentAgent = currentAgent
        ? { ...currentAgent, status: "disabled" }
        : null;
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-after-sandbox",
    });

    expect(connectSandbox).toHaveBeenCalledTimes(1);
    expect(sandboxExec).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("rechecks live authorization before Composio session resolution", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: ["github"] });
    afterEventRecorded = (event) => {
      if (event.eventName === "background-agent.git.context.completed") {
        currentAgent = currentAgent
          ? { ...currentAgent, status: "disabled" }
          : null;
      }
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-before-composio",
    });

    expect(resolveComposioToolsForBgRun).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("rechecks live authorization before working-branch mutation", async () => {
    currentAgent = buildAgent({ githubActions: { push: true } });
    afterEventRecorded = (event) => {
      if (event.eventName === "background-agent.git.context.completed") {
        currentAgent = currentAgent
          ? { ...currentAgent, status: "disabled" }
          : null;
      }
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-before-branch",
    });

    expect(
      sandboxExec.mock.calls.some(([command]) =>
        (command as string).includes("git checkout"),
      ),
    ).toBe(false);
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("terminal retries short-circuit before snapshot validation or authorization", async () => {
    const completedSummary = {
      headline: "Keep the completed summary",
      checked: [],
      changed: [],
      blocked: [],
      artifacts: [],
      next: [],
      warnings: [],
    };
    currentRun = buildSnapshotRun(buildAgent(), {
      status: "succeeded",
      definitionHash: "0".repeat(64),
      resultSummary: completedSummary,
    });
    currentAgent = buildAgent({ status: "disabled" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-terminal-retry",
    });

    expect(verifyRepoAccess).not.toHaveBeenCalled();
    expect(updateBackgroundAgentRunStatus).not.toHaveBeenCalled();
    expect(recordBackgroundAgentEvent).not.toHaveBeenCalled();
    expect(persistRunSummary).not.toHaveBeenCalled();
    expect(currentRun.resultSummary).toBe(completedSummary);
  });

  test("an invalid-snapshot retry cannot append failure evidence or overwrite its summary", async () => {
    currentRun = buildSnapshotRun(buildAgent(), {
      definitionHash: "0".repeat(64),
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-invalid-retry",
    });
    const summaryAfterFailure = currentRun.resultSummary;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-invalid-retry",
    });

    expect(
      recordedEventsNamed("background-agent.snapshot.invalid"),
    ).toHaveLength(1);
    expect(recordedEventsNamed("background-agent.run.failed")).toHaveLength(1);
    expect(persistRunSummary).toHaveBeenCalledTimes(1);
    expect(currentRun.resultSummary).toBe(summaryAfterFailure);
  });

  test("a lost failure transition emits no evidence and preserves the winning summary", async () => {
    currentRun = buildSnapshotRun(buildAgent(), {
      definitionHash: "0".repeat(64),
    });
    const winningSummary = {
      headline: "Another worker already completed",
      checked: [],
      changed: [],
      blocked: [],
      artifacts: [],
      next: [],
      warnings: [],
    };
    beforeStatusUpdate = () => {
      currentRun = {
        ...currentRun,
        status: "succeeded",
        resultSummary: winningSummary,
      };
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-failure-race",
    });

    expect(
      recordedEventsNamed("background-agent.snapshot.invalid"),
    ).toHaveLength(0);
    expect(recordedEventsNamed("background-agent.run.failed")).toHaveLength(0);
    expect(persistRunSummary).not.toHaveBeenCalled();
    expect(currentRun.status).toBe("succeeded");
    expect(currentRun.resultSummary).toBe(winningSummary);
  });

  test("uses every frozen behavior field after the live source is edited", async () => {
    const accepted = buildAgent({
      name: "Frozen definition",
      instructions: "FROZEN-INSTRUCTIONS-CANARY",
      checkCommand: null,
      composioToolkitSlugs: [],
      builtinToolNames: ["bash"],
      githubActions: { comment_on_pr_or_issue: true },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      modelId: "anthropic/claude-haiku-4.5",
    });
    currentRun = buildSnapshotRun(accepted);
    currentAgent = buildAgent({
      name: "Edited definition",
      instructions: "MUTATED-INSTRUCTIONS-CANARY",
      builtinToolNames: ["bash"],
      githubActions: { comment_on_pr_or_issue: true },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      modelId: null,
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-snapshot",
    });

    const call = generateCalls[0];
    expect(JSON.stringify(call?.messages)).toContain(
      "FROZEN-INSTRUCTIONS-CANARY",
    );
    expect(JSON.stringify(call?.messages)).not.toContain(
      "MUTATED-INSTRUCTIONS-CANARY",
    );
    expect(call?.options.allowedBuiltinToolNames).toEqual(["bash"]);
    expect(call?.options.model).toMatchObject({
      id: "anthropic/claude-haiku-4.5",
    });
    expect(Object.keys(call?.tools ?? {})).toEqual([
      "github_comment_on_pr_or_issue",
    ]);
  });

  test("live security edits may revoke frozen GitHub actions", async () => {
    currentRun = buildSnapshotRun(
      buildAgent({ githubActions: { comment_on_pr_or_issue: true } }),
    );
    currentAgent = buildAgent({ githubActions: {} });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-live-revoke",
    });

    expect(Object.keys(generateCalls[0]?.tools ?? {})).toEqual([]);
  });

  test("later live expansion never grants more than frozen intent", async () => {
    currentRun = buildSnapshotRun(buildAgent({ githubActions: {} }));
    currentAgent = buildAgent({ githubActions: { push: true } });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-live-expand",
    });

    expect(Object.keys(generateCalls[0]?.tools ?? {})).toEqual([]);
    expect(
      sandboxExec.mock.calls.some(([command]) =>
        (command as string).includes("git checkout"),
      ),
    ).toBe(false);
  });

  test("executes a frozen private check command without persisting it in events", async () => {
    const privateCommand = "bun test --token=private-check-command-canary";
    currentRun = buildSnapshotRun(buildAgent({ checkCommand: privateCommand }));
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-private-check",
    });

    expect(sandboxExec).toHaveBeenCalledWith(
      privateCommand,
      "/workspace/widgets",
      expect.any(Number),
    );
    expect(JSON.stringify(recordedEvents())).not.toContain(
      "private-check-command-canary",
    );
    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      payload: {
        commandLabel: "required_check",
        commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  const invalidCases: Array<{
    label: string;
    overrides: Record<string, unknown>;
    errorKind: string;
  }> = [
    {
      label: "partial tuple",
      overrides: { definitionHash: null },
      errorKind: "snapshot_invalid",
    },
    {
      label: "unsupported version",
      overrides: { definitionVersion: 2 },
      errorKind: "snapshot_version_unsupported",
    },
    {
      label: "hash mismatch",
      overrides: { definitionHash: "0".repeat(64) },
      errorKind: "snapshot_hash_mismatch",
    },
    {
      label: "repository mismatch",
      overrides: { repoName: "different-repo" },
      errorKind: "snapshot_invalid",
    },
    {
      label: "unsafe corrupted metadata",
      overrides: {
        definitionVersion: 1_000_001,
        definitionHash: "secret-looking-corrupt-hash-value",
      },
      errorKind: "snapshot_version_unsupported",
    },
  ];

  invalidCases.forEach(({ label, overrides, errorKind }) => {
    test(`fails ${label} before running or allocating a sandbox`, async () => {
      currentRun = buildSnapshotRun(buildAgent(), overrides);
      const { executeBackgroundAgentRun } = await executorModulePromise;

      await executeBackgroundAgentRun({
        runId: currentRun.id,
        workflowRunId: "wf-invalid",
      });

      expect(connectSandbox).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(updateBackgroundAgentRunStatus.mock.calls[0]?.[0]).toMatchObject({
        status: "failed",
        errorKind,
      });
      expect(
        recordedEvent("background-agent.workflow.started"),
      ).toBeUndefined();
      const invalidEvent = recordedEvent("background-agent.snapshot.invalid");
      expect(invalidEvent).toMatchObject({
        status: "failed",
        level: "error",
        errorKind,
        payload: {
          definitionVersion:
            typeof currentRun.definitionVersion === "number" &&
            Number.isSafeInteger(currentRun.definitionVersion) &&
            currentRun.definitionVersion >= 0 &&
            currentRun.definitionVersion <= 1000
              ? currentRun.definitionVersion
              : null,
          definitionHash:
            typeof currentRun.definitionHash === "string" &&
            /^[0-9a-f]{64}$/.test(currentRun.definitionHash)
              ? currentRun.definitionHash
              : null,
        },
      });
      expect(JSON.stringify(invalidEvent)).not.toContain("instructions");
      expect(JSON.stringify(invalidEvent)).not.toContain(
        "secret-looking-corrupt-hash-value",
      );
      expect(recordedEvents().map((event) => event.eventName)).toEqual([
        "background-agent.snapshot.invalid",
        "background-agent.run.failed",
      ]);
    });
  });

  test("distinguishes deleted from disabled sources before sandbox cost", async () => {
    currentRun = buildSnapshotRun(buildAgent());
    currentAgent = null;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-deleted",
    });

    expect(connectSandbox).not.toHaveBeenCalled();
    expect(updateBackgroundAgentRunStatus.mock.calls[0]?.[0]).toMatchObject({
      errorKind: "agent_deleted",
    });

    updateBackgroundAgentRunStatus.mockClear();
    currentRun = buildSnapshotRun(buildAgent());
    currentAgent = buildAgent({ status: "disabled" });
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-disabled",
    });
    expect(updateBackgroundAgentRunStatus.mock.calls[0]?.[0]).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("uses the fresh nullable agent id when deletion races initial validation", async () => {
    currentRun = buildSnapshotRun(buildAgent());
    const acceptedRun = currentRun;
    const acceptedAgent = currentAgent;
    getBackgroundAgentRunWithAgent.mockImplementationOnce(async () => ({
      run: acceptedRun,
      agent: acceptedAgent,
    }));
    currentRun = { ...currentRun, agentId: null };
    currentAgent = null;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-delete-race",
    });

    expect(connectSandbox).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      agentId: null,
      errorKind: "agent_deleted",
    });
  });

  test("legacy rows use an explicit observable live fallback", async () => {
    currentRun = buildRun();
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-legacy",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      recordedEvent("background-agent.snapshot.legacy_fallback"),
    ).toBeTruthy();
  });
});

describe("(b) required-permission derivation per toggle set", () => {
  const cases: Array<{
    label: string;
    githubActions: BackgroundAgent["githubActions"];
    expected: "read" | "write";
  }> = [
    {
      label: "comment-only → read",
      githubActions: { comment_on_pr_or_issue: true },
      expected: "read",
    },
    {
      label: "no actions enabled → read",
      githubActions: {},
      expected: "read",
    },
    {
      label: "push enabled → write",
      githubActions: { push: true },
      expected: "write",
    },
    {
      label: "merge_pull_request enabled → write",
      githubActions: { merge_pull_request: true },
      expected: "write",
    },
    {
      label: "delete_branch enabled → write",
      githubActions: { delete_branch: true },
      expected: "write",
    },
    {
      label: "open_pull_request enabled → write",
      githubActions: { open_pull_request: true },
      expected: "write",
    },
    {
      label: "approve_pull_request enabled → write",
      githubActions: { approve_pull_request: true },
      expected: "write",
    },
    {
      label: "request_changes enabled → write",
      githubActions: { request_changes: true },
      expected: "write",
    },
  ];

  cases.forEach((testCase) => {
    test(testCase.label, async () => {
      currentAgent = buildAgent({ githubActions: testCase.githubActions });
      const { executeBackgroundAgentRun } = await executorModulePromise;

      await executeBackgroundAgentRun({
        runId: currentRun.id,
        workflowRunId: "wf-1",
      });

      expect(accessRequiredPermissionSeen[0]).toBe(testCase.expected);
    });
  });
});

describe("(c) model resolution", () => {
  test("uses the concrete default frozen at queue time after the live source changes", async () => {
    const acceptedAgent = buildAgent({ modelId: null });
    currentRun = buildSnapshotRun(acceptedAgent, {
      executionSnapshot: buildBackgroundAgentExecutionSnapshot(acceptedAgent, {
        route: "gateway",
        modelId: "anthropic/claude-haiku-4.5",
      }),
    });
    currentAgent = buildAgent({ modelId: "anthropic/claude-opus-4.6" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    expect(generateCalls[0]?.options.model).toMatchObject({
      id: "anthropic/claude-haiku-4.5",
    });
  });

  test("passes the agent's plain gateway modelId as options.model and records it on usage", async () => {
    currentAgent = buildAgent({ modelId: "anthropic/claude-haiku-4.5" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    const call = generateCalls[0];
    expect(call?.options?.model).toMatchObject({
      id: "anthropic/claude-haiku-4.5",
    });
    expect(recordUsage).toHaveBeenCalledWith(
      "user-v2",
      expect.objectContaining({ model: "anthropic/claude-haiku-4.5" }),
    );
  });

  test("resolves a user-profile: selection via resolveInferenceProfileModelSelection", async () => {
    const acceptedAgent = buildAgent({
      modelId: "user-profile:profile-1:glm-4.6",
    });
    const executionSnapshot = buildBackgroundAgentExecutionSnapshot(
      acceptedAgent,
      {
        route: "user",
        modelId: "glm-4.6",
        inferenceProfileId: "profile-1",
        provider: "anthropic",
        baseUrl: "https://inference.example.com/v1",
      },
    );
    currentRun = buildSnapshotRun(acceptedAgent, { executionSnapshot });
    currentAgent = acceptedAgent;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    const call = generateCalls[0];
    expect(call?.options?.model).toMatchObject({ id: "glm-4.6" });
    expect(recordUsage).toHaveBeenCalledWith(
      "user-v2",
      expect.objectContaining({ model: "glm-4.6" }),
    );
    expect(inferenceResolutionCalls[0]).toMatchObject({
      inferenceProfileId: "profile-1",
      expectedRoute: {
        provider: "anthropic",
        baseUrl: "https://inference.example.com/v1",
      },
    });
  });

  test("revokes an accepted user route when the live profile changes before the model turn", async () => {
    const acceptedAgent = buildAgent({
      modelId: "user-profile:profile-1:glm-4.6",
    });
    const executionSnapshot = buildBackgroundAgentExecutionSnapshot(
      acceptedAgent,
      {
        route: "user",
        modelId: "glm-4.6",
        inferenceProfileId: "profile-1",
        provider: "anthropic",
        baseUrl: "https://inference.example.com/v1",
      },
    );
    currentRun = buildSnapshotRun(acceptedAgent, { executionSnapshot });
    currentAgent = acceptedAgent;
    // Initial validation passes. The mocked model resolver does not perform
    // its own DB check, so the second call is the executor guard immediately
    // before the first model turn.
    inferenceRouteAvailabilityFailureAt = 2;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    expect(generate).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "model_resolution_failed",
    });
  });

  test("fails the run with model_resolution_failed instead of silently falling back", async () => {
    currentAgent = buildAgent({
      modelId: "user-profile:missing-profile:glm-4.6",
    });
    inferenceProfileResolutionShouldFail = true;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    // The agent loop must NEVER run when model resolution fails — no silent
    // fallback to the default model.
    expect(generate).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "model_resolution_failed",
    });
    const statusUpdates = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]) => input,
    );
    expect(statusUpdates.at(-1)).toMatchObject({
      status: "failed",
      errorKind: "model_resolution_failed",
    });
  });
});

describe("(d) denial events", () => {
  test("emits background-agent.tool.denied when the sanitizer rewrites messages", async () => {
    sanitizerShouldDeny = {
      toolCallId: "call-123",
      toolName: "web_fetch",
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    const deniedEvents = recordedEventsNamed("background-agent.tool.denied");
    expect(deniedEvents.length).toBeGreaterThan(0);
    expect(deniedEvents[0]).toMatchObject({
      status: "failed",
      level: "warn",
      payload: { toolName: "web_fetch" },
    });
  });

  test("does not emit background-agent.tool.denied when nothing was denied", async () => {
    sanitizerShouldDeny = null;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    expect(recordedEventsNamed("background-agent.tool.denied")).toHaveLength(0);
  });
});

describe("(e) ready_pr-equivalent flow: push + open_pr toggles", () => {
  test("agent with push+open_pr toggles → github_push and github_open_pull_request tools available, outputs rows recorded on use", async () => {
    currentAgent = buildAgent({
      githubActions: { push: true, open_pull_request: true },
    });
    // Simulate the model calling github_push then github_open_pull_request.
    generateImpl = async (input) => {
      const pushTool = input.tools?.github_push as
        | { execute: (args: unknown) => Promise<unknown> }
        | undefined;
      const openPrTool = input.tools?.github_open_pull_request as
        | { execute: (args: unknown) => Promise<unknown> }
        | undefined;
      expect(pushTool).toBeDefined();
      expect(openPrTool).toBeDefined();

      await pushTool?.execute({
        branch: "background-agent/e2e-agent/run_1234abcd",
        message: "chore: apply changes",
      });
      await openPrTool?.execute({
        branchName: "background-agent/e2e-agent/run_1234abcd",
        title: "chore: E2E agent",
        body: "Automated PR",
      });

      return {
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { messages: [] },
        steps: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    };

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    // Working branch was prepared before the loop (write action enabled).
    expect(
      sandboxExec.mock.calls.some(([command]) =>
        (command as string).includes("git checkout"),
      ),
    ).toBe(true);

    // Both action tools were actually invoked via the mocked octokit path.
    expect(openPullRequest).toHaveBeenCalled();

    // Output rows were recorded for both actions (push + open_pull_request).
    const pushOutputs = recordedOutputs.filter((o) => o.kind === "push");
    const prOutputs = recordedOutputs.filter((o) => o.kind === "ready_pr");
    expect(pushOutputs.length).toBeGreaterThan(0);
    expect(prOutputs.length).toBeGreaterThan(0);
    expect(prOutputs[0]).toMatchObject({
      status: "created",
      url: "https://github.com/acme/widgets/pull/55",
      prNumber: 55,
    });

    // Terminal outputUrl reflects the newest created output with a URL.
    const statusUpdates = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]) => input,
    );
    expect(statusUpdates.at(-1)).toMatchObject({
      status: "succeeded",
      outputUrl: "https://github.com/acme/widgets/pull/55",
    });
  });
});

describe("normalized background execution boundary (#966)", () => {
  test("builds exactly one normalized sandbox input before sandbox work and emits safe acceptance evidence", async () => {
    currentRun = buildSnapshotRun(buildAgent());
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-once",
    });

    expect(buildNormalizedBackgroundSandboxInput).toHaveBeenCalledTimes(1);
    expect(buildNormalizedBackgroundLearningsInput).not.toHaveBeenCalled();
    const builderCall =
      buildNormalizedBackgroundSandboxInput.mock.calls[0]?.[0];
    expect(builderCall).toMatchObject({
      resolvedDefinition: {
        snapshotSource: "frozen",
        definitionVersion: 1,
        definitionHash: currentRun.definitionHash,
      },
      identity: {
        runId: currentRun.id,
        userId: currentRun.userId,
        triggerId: currentRun.triggerId,
        requestId: currentRun.requestId,
        workflowRunId: "wf-normalized-once",
      },
    });
    expect(connectSandbox).toHaveBeenCalledTimes(1);
    const accepted = recordedEvent(
      "background-agent.normalized-input.accepted",
    );
    expect(accepted).toMatchObject({
      status: "succeeded",
      level: "info",
      payload: {
        runId: currentRun.id,
        agentId: currentRun.agentId,
        inputVersion: 1,
        definitionVersion: 1,
        definitionHash: currentRun.definitionHash,
        snapshotSource: "frozen",
        requestId: currentRun.requestId,
        workflowRunId: "wf-normalized-once",
        workspacePolicy: "persistent_resume",
      },
    });
    expect(recordedEvents().indexOf(accepted as EventInput)).toBeLessThan(
      recordedEvents().findIndex(
        (event) => event.eventName === "background-agent.sandbox.started",
      ),
    );
  });

  test("uses normalized frozen behavior for prompt, model, tools, checkout, and verification after live edits", async () => {
    const acceptedAgent = buildAgent({
      instructions: "snapshot instructions",
      checkCommand: "snapshot-check",
      builtinToolNames: ["read"],
      githubActions: { push: true },
      modelId: "anthropic/claude-haiku-4.5",
    });
    currentRun = buildSnapshotRun(acceptedAgent);
    currentAgent = buildAgent({
      instructions: "live edited instructions",
      checkCommand: "live-check",
      builtinToolNames: ["bash", "write"],
      githubActions: { comment_on_pr_or_issue: true },
      modelId: "anthropic/claude-opus-4.6",
    });
    normalizedSandboxImpl = (input) => {
      const normalized = realBuildNormalizedBackgroundSandboxInput(input);
      return {
        ...normalized,
        prompt: {
          definitionName: "Normalized definition",
          instructions: "NORMALIZED-INSTRUCTIONS-CANARY",
        },
        model: {
          route: "gateway",
          modelId: "anthropic/claude-haiku-4.5",
        },
        requestedPolicy: {
          ...normalized.requestedPolicy,
          builtinToolNames: ["bash"],
          composioToolkitSlugs: [],
          github: {
            kind: "background_actions",
            actions: {
              open_pull_request: false,
              comment_on_pr_or_issue: true,
              approve_pull_request: false,
              request_changes: false,
              merge_pull_request: false,
              push: false,
              delete_branch: false,
            },
            writeScope: { mode: "this_repo" },
            requireCiGreenForMerge: true,
          },
        },
        verification: {
          kind: "command",
          command: "bun test normalized-check-canary",
        },
        workspace: {
          ...normalized.workspace,
          initialCheckout: {
            ref: "normalized-checkout-branch",
            source: "event_branch",
          },
        },
      };
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-fields",
    });

    expect(JSON.stringify(generateCalls[0]?.messages)).toContain(
      "NORMALIZED-INSTRUCTIONS-CANARY",
    );
    expect(generateCalls[0]?.options).toMatchObject({
      allowedBuiltinToolNames: ["bash"],
      model: { id: "anthropic/claude-haiku-4.5" },
    });
    expect(Object.keys(generateCalls[0]?.tools ?? {})).toEqual([
      "github_comment_on_pr_or_issue",
    ]);
    expect(connectSandbox.mock.calls[0]?.[0]).toMatchObject({
      state: {
        source: { branch: "normalized-checkout-branch" },
      },
    });
    expect(sandboxExec).toHaveBeenCalledWith(
      "bun test normalized-check-canary",
      "/workspace/widgets",
      expect.any(Number),
    );
    const serialized = JSON.stringify({
      calls: generateCalls,
      events: recordedEvents(),
    });
    expect(serialized).not.toContain("live edited instructions");
    expect(serialized).not.toContain("live-check");
  });

  test("normalizes the built-in learnings path once without creating a workspace", async () => {
    const learningsAgent = buildAgent({
      instructions:
        "[builtin:pr-review-learnings] Extract learnings from merged pull requests.",
      githubActions: {},
    });
    currentRun = buildSnapshotRun(learningsAgent);
    currentAgent = learningsAgent;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-learnings",
    });

    expect(buildNormalizedBackgroundLearningsInput).toHaveBeenCalledTimes(1);
    expect(buildNormalizedBackgroundSandboxInput).not.toHaveBeenCalled();
    expect(connectSandbox).not.toHaveBeenCalled();
    expect(
      recordedEvent("background-agent.normalized-input.accepted"),
    ).toMatchObject({
      payload: {
        inputVersion: 1,
        workspacePolicy: "none",
        snapshotSource: "frozen",
      },
    });
  });

  test("keeps live revocation separate from frozen requested policy and fails closed after normalization", async () => {
    currentRun = buildSnapshotRun(
      buildAgent({
        githubActions: { comment_on_pr_or_issue: true, push: true },
      }),
    );
    currentAgent = buildAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    afterEventRecorded = (event) => {
      if (event.eventName === "background-agent.normalized-input.accepted") {
        currentAgent = { ...currentAgent!, status: "disabled" };
      }
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-revoked",
    });

    const built = normalizedSandboxOutputs[0];
    expect(built?.requestedPolicy.github.actions).toMatchObject({
      comment_on_pr_or_issue: true,
      push: true,
    });
    expect(connectSandbox).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "agent_disabled",
    });
  });

  test("live built-in tool revocation narrows normalized requested policy", async () => {
    currentRun = buildSnapshotRun(buildAgent({ builtinToolNames: ["bash"] }));
    currentAgent = buildAgent({ builtinToolNames: [] });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-builtin-revoked",
    });

    expect(
      normalizedSandboxOutputs[0]?.requestedPolicy.builtinToolNames,
    ).toEqual(["bash"]);
    expect(generateCalls[0]?.options.allowedBuiltinToolNames).toEqual([]);
  });

  test("preserves the durable background sandbox lifecycle", async () => {
    currentRun = buildSnapshotRun(buildAgent());
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-workspace",
    });

    expect(connectSandbox.mock.calls[0]?.[0]).toMatchObject({
      state: { sandboxName: `background_agent_${currentRun.id}` },
      options: {
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
  });

  test("rejects invalid normalized input with safe terminal evidence before sandbox allocation", async () => {
    currentRun = buildSnapshotRun(
      buildAgent({ instructions: "PRIVATE-NORMALIZED-SECRET-CANARY" }),
    );
    normalizedSandboxImpl = () => {
      throw new normalizedRuntime.NormalizedUnattendedInputError(
        "normalized_input_invalid",
        [{ code: "too_big", path: ["prompt", "instructions"] }],
      );
    };
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-rejected",
    });

    expect(connectSandbox).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(currentRun).toMatchObject({
      status: "failed",
      errorKind: "normalized_input_invalid",
    });
    expect(
      recordedEvent("background-agent.normalized-input.rejected"),
    ).toMatchObject({
      status: "failed",
      level: "error",
      errorKind: "normalized_input_invalid",
      payload: {
        runId: currentRun.id,
        agentId: currentRun.agentId,
        errorKind: "normalized_input_invalid",
        safeFieldPaths: ["prompt.instructions"],
        requestId: currentRun.requestId,
        workflowRunId: "wf-normalized-rejected",
      },
    });
    expect(JSON.stringify(recordedEvents())).not.toContain(
      "PRIVATE-NORMALIZED-SECRET-CANARY",
    );
  });

  test("does not rebuild normalized input on duplicate terminal delivery and keeps legacy provenance explicit", async () => {
    currentRun = buildSnapshotRun(buildAgent());
    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-duplicate",
    });
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-duplicate",
    });
    expect(buildNormalizedBackgroundSandboxInput).toHaveBeenCalledTimes(1);

    buildNormalizedBackgroundSandboxInput.mockClear();
    recordBackgroundAgentEvent.mockClear();
    currentRun = buildRun();
    currentAgent = buildAgent();
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-legacy",
    });
    expect(buildNormalizedBackgroundSandboxInput).toHaveBeenCalledTimes(1);
    expect(
      recordedEvent("background-agent.normalized-input.accepted"),
    ).toMatchObject({
      payload: {
        inputVersion: 1,
        definitionVersion: null,
        definitionHash: null,
        snapshotSource: "legacy_live_fallback",
        workspacePolicy: "persistent_resume",
      },
    });
  });

  test("accepted evidence never serializes the normalized body, instructions, provider configuration, or runtime objects", async () => {
    const acceptedAgent = buildAgent({
      instructions: "PRIVATE-INSTRUCTIONS-CANARY",
      modelId: "anthropic/claude-haiku-4.5",
    });
    currentRun = buildSnapshotRun(acceptedAgent);
    currentAgent = acceptedAgent;
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-normalized-redaction",
    });

    const accepted = recordedEvent(
      "background-agent.normalized-input.accepted",
    );
    expect(accepted).toBeDefined();
    const serialized = JSON.stringify(accepted);
    for (const forbidden of [
      "PRIVATE-INSTRUCTIONS-CANARY",
      "requestedPolicy",
      "resolvedDefinition",
      "sandboxState",
      "providerConfig",
      "githubToken",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("collectDeniedToolNames (#746 review fix)", () => {
  test("reports only denials added this round, not prior-round denials still in history", async () => {
    const { collectDeniedToolNames } = await import("./executor");
    const oldDenial = {
      type: "tool-result",
      toolName: "bash",
      output: { type: "execution-denied" },
    };
    const newDenial = {
      type: "tool-result",
      toolName: "web_fetch",
      output: { type: "execution-denied" },
    };
    const priorToolMessage = { role: "tool" as const, content: [oldDenial] };
    const before = [priorToolMessage];
    const after = [
      priorToolMessage,
      { role: "tool" as const, content: [newDenial] },
    ];

    expect(
      collectDeniedToolNames(
        before as unknown as Parameters<typeof collectDeniedToolNames>[0],
        after as unknown as Parameters<typeof collectDeniedToolNames>[1],
      ),
    ).toEqual(["web_fetch"]);
  });

  test("returns empty for identical reference", async () => {
    const { collectDeniedToolNames } = await import("./executor");
    const messages: unknown[] = [];
    expect(
      collectDeniedToolNames(
        messages as Parameters<typeof collectDeniedToolNames>[0],
        messages as Parameters<typeof collectDeniedToolNames>[1],
      ),
    ).toEqual([]);
  });
});
