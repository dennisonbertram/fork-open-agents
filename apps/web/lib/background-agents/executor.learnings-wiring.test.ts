/**
 * TASK-274: Executor wiring for built-in learnings agent.
 *
 * Tests that executeBackgroundAgentRun:
 *  - Detects the learnings agent via isLearningsAgent (marker in instructions)
 *  - Invokes runLearningsExtraction WITHOUT entering sandbox setup
 *  - Records completion status / events on success
 *  - Records failure status when runner returns errorKind
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";

mock.module("server-only", () => ({}));
process.env.BACKGROUND_AGENTS_ENABLED = "true";
process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";

// ---- Stub helpers ----
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

type StatusUpdateInput = {
  runId: string;
  status: BackgroundAgentRun["status"];
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
};

// ---- learnings runner mock ----
let learningsResult: {
  candidatesExtracted: number;
  accepted: number;
  merged: number;
  rejected: number;
  errorKind?: string;
} = {
  candidatesExtracted: 3,
  accepted: 2,
  merged: 0,
  rejected: 1,
};

const runLearningsExtraction = mock(async () => learningsResult);

mock.module("@/lib/learnings/runner", () => ({
  runLearningsExtraction,
}));

// ---- Sandbox connect mock — must NOT be called ----
const connectSandbox = mock(async () => {
  throw new Error("connectSandbox should not be called for learnings agent");
});

mock.module("@open-agents/sandbox", () => ({
  connectSandbox,
  getCurrentBranch: mock(async () => "main"),
  getStagedDiff: mock(async () => ""),
  hasUncommittedChanges: mock(async () => false),
  stageAll: mock(async () => undefined),
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: "snapshot-test",
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// ---- Store mocks ----
let currentRun: BackgroundAgentRun;
let currentAgent: BackgroundAgent | null;

const getBackgroundAgentRunWithAgent = mock(async () => ({
  run: currentRun,
  agent: currentAgent,
}));
const recordBackgroundAgentEvent = mock(async (input: EventInput) => input);
const updateBackgroundAgentRunStatus = mock(
  async (input: StatusUpdateInput): Promise<BackgroundAgentRun> => ({
    ...currentRun,
    status: input.status,
    workflowRunId: input.workflowRunId ?? currentRun.workflowRunId,
    sandboxName: input.sandboxName ?? currentRun.sandboxName,
    errorKind: input.errorKind ?? currentRun.errorKind,
    errorMessage: input.errorMessage ?? currentRun.errorMessage,
  }),
);
const listBackgroundAgentEvents = mock(async () => []);
// #798 P2-1: uncapped, composio-scoped fetch — default empty so existing
// tests (which never assert on the merge) are unaffected.
const listBackgroundAgentComposioEvents = mock(async () => []);
const listBackgroundAgentOutputs = mock(async () => []);

mock.module("./store", () => ({
  seedTriggerNextRunAt: async () => undefined,
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput: mock(async (input: unknown) => input),
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentComposioEvents,
  listBackgroundAgentOutputs,
  // These are needed by builtin-agent.ts (imported via isLearningsAgent)
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

// ---- GitHub access + app mocks ----
const verifyRepoAccess = mock(async () => ({
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
}));
const getRepoAccessErrorMessage = mock((reason: string) => reason);
const withScopedInstallationOctokit = mock(
  async (params: { operation: (octokit: unknown) => Promise<unknown> }) =>
    params.operation({}),
);
const mintInstallationToken = mock(async () => ({ token: "test-token" }));
const revokeInstallationToken = mock(async () => undefined);

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
  buildCoAuthor: mock(async () => ({
    name: "mona",
    email: "1+mona@users.noreply.github.com",
  })),
  createCommit: mock(async () => ({ ok: true, commitSha: "commit-sha-1" })),
}));

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: mock(async () => ({ ok: false })),
}));

mock.module("@/lib/github/pulls", () => ({
  openPullRequest: mock(async () => ({ success: false })),
  mergePullRequest: mock(async () => ({ success: false })),
  submitPullRequestReview: mock(async () => ({ success: false })),
  deleteBranchRef: mock(async () => ({ success: false })),
  getMergeReadinessViaInstallation: mock(async () => ({
    canMerge: false,
    checks: { failed: 0, pending: 0, passed: 0 },
    reasons: [],
  })),
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

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: (modelId: string) => modelId,
  defaultModelLabel: "anthropic/claude-opus-4.6",
  openAgent: { generate: mock(async () => ({})) },
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

// ---- Learnings store mock ----
mock.module("@/lib/learnings/store", () => ({
  createDbLearningsStore: mock(() => ({
    findForDedup: mock(async () => []),
    createLearning: mock(async (learning: unknown) => learning),
    updateLearning: mock(async (_id: string, updates: unknown) => updates),
    recordExtractionRun: mock(async (run: unknown) => run),
  })),
}));

// ai module is not used directly in the executor — runLearningsExtraction is mocked above

const executorModulePromise = import("./executor");

// ---- The LEARNINGS_AGENT_MARKER ----
const LEARNINGS_AGENT_MARKER = "[builtin:pr-review-learnings]";

function buildLearningsRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "run-learnings-1",
    agentId: "agent-learnings-1",
    triggerId: "trigger-1",
    userId: "user-1",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "pull_request:101:closed:abc123",
    idempotencyKey: "idempotency-learnings-1",
    repoOwner: "acme",
    repoName: "widgets",
    ref: "feature/stuff",
    sha: "abc123",
    branch: "main",
    prNumber: 42,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {
      title: "Merge feature PR",
      actor: "mona",
      action: "closed",
    },
    requestId: "req-learnings-1",
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

function buildLearningsAgent(
  overrides: Partial<BackgroundAgent> = {},
): BackgroundAgent {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "agent-learnings-1",
    userId: "user-1",
    name: "PR Review Learnings",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    // The marker identifies this as the built-in learnings agent
    instructions: `${LEARNINGS_AGENT_MARKER} Extract engineering learnings from merged PRs.`,
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

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  learningsResult = {
    candidatesExtracted: 3,
    accepted: 2,
    merged: 0,
    rejected: 1,
  };
  currentRun = buildLearningsRun();
  currentAgent = buildLearningsAgent();
  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  connectSandbox.mockClear();
  runLearningsExtraction.mockClear();
  runLearningsExtraction.mockImplementation(async () => learningsResult);
  getBackgroundAgentRunWithAgent.mockImplementation(async () => ({
    run: currentRun,
    agent: currentAgent,
  }));
});

describe("executeBackgroundAgentRun — learnings built-in agent wiring", () => {
  test("invokes runLearningsExtraction for agent with the builtin marker in instructions", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-1",
    });

    expect(runLearningsExtraction).toHaveBeenCalledTimes(1);
  });

  test("requires only read access for the learnings built-in agent even with write toggles (#746 review)", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-perm",
    });

    const calls = (
      verifyRepoAccess as unknown as {
        mock: { calls: Array<[{ requiredUserPermission?: string }]> };
      }
    ).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)?.[0]?.requiredUserPermission).toBe("read");
  });

  test("does NOT call connectSandbox for the learnings built-in agent", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-1",
    });

    expect(connectSandbox).not.toHaveBeenCalled();
  });

  test("marks run as succeeded when runLearningsExtraction succeeds", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-1",
    });

    const statusUpdates = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]) => input,
    );
    const terminalUpdate = statusUpdates.find(
      (u) => u.status === "succeeded" || u.status === "failed",
    );
    expect(terminalUpdate).toBeDefined();
    expect(terminalUpdate?.status).toBe("succeeded");
  });

  test("marks run as failed when runner returns errorKind", async () => {
    learningsResult = {
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind: "extraction_parse_failed",
    };
    runLearningsExtraction.mockImplementation(async () => learningsResult);
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-1",
    });

    const statusUpdates = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]) => input,
    );
    const terminalUpdate = statusUpdates.find(
      (u) => u.status === "succeeded" || u.status === "failed",
    );
    expect(terminalUpdate).toBeDefined();
    expect(terminalUpdate?.status).toBe("failed");
    expect(terminalUpdate?.errorKind).toBe("extraction_parse_failed");
  });

  test("regular non-learnings agent still calls connectSandbox (no regression)", async () => {
    // Override agent to NOT have the learnings marker
    currentAgent = {
      ...buildLearningsAgent(),
      instructions: "Fix the failing smoke check.",
    };
    getBackgroundAgentRunWithAgent.mockImplementation(async () => ({
      run: currentRun,
      agent: currentAgent,
    }));
    // connectSandbox now uses a version that doesn't throw
    connectSandbox.mockImplementation(async () => {
      throw new Error("sandbox_unavailable"); // will fail run gracefully
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wfr-2",
    });

    // connectSandbox should have been attempted (and failed), learningsExtraction should not
    expect(connectSandbox).toHaveBeenCalledTimes(1);
    expect(runLearningsExtraction).not.toHaveBeenCalled();
  });
});
