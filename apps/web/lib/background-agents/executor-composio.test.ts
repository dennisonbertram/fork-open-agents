/**
 * Phase 5 — Background agent Composio tool resolution tests.
 *
 * BT-001: Empty toolkit list / no enabled grant => no composio tools, run behavior unchanged.
 * BT-002: Agent with allowed toolkits => resolveComposioToolsForBgRun called + tools injected into openAgent.generate.
 * BT-003: Repo policy / grant gating — disabled grant => composio excluded.
 * BT-004: v1-block removed — customInstructions no longer hard-excludes Composio.
 * BT-005: Observability event emitted with toolkit names, no secrets.
 *
 * Issue #798 — degradation visibility:
 * BT-007: "off" outcome (no_slugs_selected) emits background-agent.composio.off
 *   with reason payload.
 * BT-008: "off" outcome (repo_policy_blocked) emits background-agent.composio.off
 *   with reason + blockedSlugs payload.
 * BT-009: "error" outcome now carries an errorKind field on the recorded event.
 * BT-010: "ready" outcome with non-empty disconnectedToolkits emits
 *   background-agent.composio.not_connected.
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

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared type stubs
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

type StatusUpdateInput = {
  runId: string;
  status: BackgroundAgentRun["status"];
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentRun: BackgroundAgentRun;
let currentAgent: BackgroundAgent | null;
const commandResults = new Map<string, ExecResult>();

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------
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
const listBackgroundAgentEvents = mock(async () => []);
const listBackgroundAgentOutputs = mock(async () => []);

// listEnabledToolGrantsForAgent: default returns no grants (no composio tools)
const listEnabledToolGrantsForAgent = mock(async (_agentId: string) => []);

mock.module("./store", () => ({
  seedTriggerNextRunAt: async () => undefined,
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
  listEnabledToolGrantsForAgent,
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
    warnings: [],
  })),
}));

mock.module("./run-summary-persist", () => ({
  persistRunSummary: mock(async () => undefined),
  recordSummaryFailedEvent: mock(async () => undefined),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: mock(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Sandbox mocks
// ---------------------------------------------------------------------------
const successfulCommand: ExecResult = {
  success: true,
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  truncated: false,
};

const sandboxExec = mock(async (command: string): Promise<ExecResult> => {
  if (commandResults.has(command)) {
    return commandResults.get(command) ?? successfulCommand;
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

const connectSandbox = mock(async () => fakeSandbox);
const getCurrentBranch = mock(async () => "main");
const getStagedDiff = mock(async () => "");
const hasUncommittedChanges = mock(async () => true);
const stageAll = mock(async () => undefined);

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

// ---------------------------------------------------------------------------
// GitHub mocks
// ---------------------------------------------------------------------------
const successfulAccess = {
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
  userPermission: "write",
} as const;

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
const createCommit = mock(async () => ({ ok: true, commitSha: "sha-1" }));
const buildCommitIntentFromSandbox = mock(async () => ({
  ok: true,
  intent: {
    owner: "acme",
    repo: "widgets",
    repositoryId: 42,
    installationId: 99,
    branch: "main",
    baseBranch: "main",
    expectedHeadSha: "base-sha",
    message: "chore: apply changes",
    files: [],
    coAuthor: null,
  },
}));
const openPullRequest = mock(async () => ({
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/42",
  prNumber: 42,
}));
const getGitHubAppUserToken = mock(async () => "user-token");
const getGitHubUserProfile = mock(async () => ({
  username: "mona",
  externalUserId: "1",
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
mock.module("@/lib/github/token", () => ({ getGitHubAppUserToken }));
mock.module("@/lib/github/users", () => ({ getGitHubUserProfile }));

// ---------------------------------------------------------------------------
// openAgent mock — captures the generate call options
// ---------------------------------------------------------------------------
type GenerateCall = {
  messages: unknown[];
  options: {
    customInstructions?: string;
    runtimeMode?: string;
    sandbox?: unknown;
  };
  tools?: Record<string, unknown>;
  timeout?: unknown;
};
const generateCalls: GenerateCall[] = [];
const generate = mock(async (input: GenerateCall) => {
  generateCalls.push(input);
  return {
    finishReason: "stop",
    rawFinishReason: "stop",
    response: { messages: [] },
    steps: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
});

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

// ---------------------------------------------------------------------------
// Composio mocks
// ---------------------------------------------------------------------------
/** Resolved tools to be returned by the resolver when called. */
const fakeComposioTools: Record<string, unknown> = {
  github_create_issue: { description: "Create a GitHub issue" },
};

type FakeComposioResult =
  | {
      status: "ready";
      tools: Record<string, unknown>;
      toolkitSlugs: string[];
      disconnectedToolkits: string[];
    }
  | {
      status: "off";
      reason: "no_slugs_selected" | "repo_policy_blocked";
      blockedSlugs?: string[];
    }
  | { status: "error"; errorKind: string; message: string };

const resolveComposioToolsForBgRun = mock(
  async (_params: unknown): Promise<FakeComposioResult> => ({
    status: "off",
    reason: "no_slugs_selected",
  }),
);

mock.module("./composio-tools", () => ({
  resolveComposioToolsForBgRun,
}));

// ---------------------------------------------------------------------------
// Lazy executor import (after all mocks are set up)
// ---------------------------------------------------------------------------
const executorModulePromise = import("./executor");
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function buildRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "run_test_composio",
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
    name: "Composio tester",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Do composio things.",
    permissions: {},
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    // All native GitHub action toggles disabled — these tests exercise
    // Composio tool injection in isolation from the native GitHub tools
    // (covered by executor.test.ts / github-action-tools.test.ts).
    githubActions: {},
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
  return recordBackgroundAgentEvent.mock.calls.map(
    ([input]: [EventInput]) => input,
  );
}

function recordedEvent(name: string) {
  return recordedEvents().find((event) => event.eventName === name);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  commandResults.clear();
  generateCalls.length = 0;

  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  sandboxExec.mockClear();
  connectSandbox.mockClear();
  verifyRepoAccess.mockClear();
  mintInstallationToken.mockClear();
  revokeInstallationToken.mockClear();
  generate.mockClear();
  listEnabledToolGrantsForAgent.mockClear();
  resolveComposioToolsForBgRun.mockClear();

  // Default: no toolkit slugs on agent, no grants, resolver returns "off"
  currentAgent = buildAgent({ composioToolkitSlugs: [] });
  listEnabledToolGrantsForAgent.mockImplementation(async () => []);
  resolveComposioToolsForBgRun.mockImplementation(async () => ({
    status: "off",
    reason: "no_slugs_selected",
  }));
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Background agent Composio tool injection (Phase 5)", () => {
  /**
   * BT-001: When agent has no composio toolkit slugs, the run proceeds exactly
   * as before — no composio tools, no change to generate call behavior.
   */
  test("BT-001: empty toolkit list → no composio tools injected, run succeeds unchanged", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: [] });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // generate was called at least once (run proceeds)
    expect(generate).toHaveBeenCalled();

    // composio resolver not called when there are no slugs
    expect(resolveComposioToolsForBgRun).not.toHaveBeenCalled();

    // No composio tools in the generate call
    const call = generateCalls[0];
    expect(call).toBeDefined();
    expect(call?.tools).toBeUndefined();

    // Run succeeded
    const statusCalls = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]: [StatusUpdateInput]) => input.status,
    );
    expect(statusCalls).toContain("succeeded");
  });

  /**
   * BT-002: When agent has composio toolkit slugs AND resolver returns ready tools,
   * the tools are injected into openAgent.generate.
   */
  test("BT-002: agent with toolkit slugs → resolver called and tools injected into generate", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["github", "linear"],
      builtinToolNames: null,
    });
    // Resolver returns ready composio tools
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "ready" as const,
      tools: fakeComposioTools,
      toolkitSlugs: ["github", "linear"],
      disconnectedToolkits: [],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Resolver was called
    expect(resolveComposioToolsForBgRun).toHaveBeenCalled();
    const resolverCall = resolveComposioToolsForBgRun.mock.calls[0]?.[0] as {
      agentId: string;
      userId: string;
      slugs: string[];
      repoOwner: string;
      repoName: string;
    };
    expect(resolverCall).toMatchObject({
      agentId: "agent-1",
      userId: "user-1",
      slugs: ["github", "linear"],
      repoOwner: "acme",
      repoName: "widgets",
    });

    // generate was called with composio tools
    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    expect(call?.tools).toBeDefined();
    expect(call?.tools?.["github_create_issue"]).toBeDefined();
  });

  /**
   * BT-003: Repo policy / grant gating — when no enabled grants exist for
   * a composio toolkit, the resolver is not called / tools are excluded.
   *
   * In this model, the executor calls resolveComposioToolsForBgRun which checks
   * the grants. If no enabled grants exist it returns { status: "off" } and
   * no tools are injected.
   */
  test("BT-003: disabled/no grant → resolver returns off → no composio tools injected", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["github", "linear"],
      builtinToolNames: null,
    });
    // Resolver returns off (no enabled grants)
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "off" as const,
      reason: "repo_policy_blocked",
      blockedSlugs: ["github", "linear"],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // Resolver was called (the agent has slugs so resolution is attempted)
    expect(resolveComposioToolsForBgRun).toHaveBeenCalled();

    // But generate was called WITHOUT composio tools
    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    expect(call?.tools).toBeUndefined();
  });

  /**
   * BT-004: The v1-block ("Composio not available in v1") is gone from
   * customInstructions. The instruction should NOT mention that Composio is
   * unavailable.
   */
  test("BT-004: v1 composio block removed from customInstructions", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    const customInstructions = call?.options?.customInstructions ?? "";
    expect(customInstructions).not.toContain("not available in v1");
    expect(customInstructions).not.toContain("Composio are not available");
  });

  /**
   * BT-005: When composio tools are resolved, a composio.resolved observability
   * event is emitted with toolkit names (no secrets/API keys).
   */
  test("BT-005: composio.resolved event emitted with toolkit names, no secrets", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["github", "linear"],
      builtinToolNames: null,
    });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "ready" as const,
      tools: fakeComposioTools,
      toolkitSlugs: ["github", "linear"],
      disconnectedToolkits: [],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // A composio.resolved event was emitted
    const composioEvent = recordedEvent("background-agent.composio.resolved");
    expect(composioEvent).toBeDefined();
    expect(composioEvent?.payload).toMatchObject({
      toolkitSlugs: ["github", "linear"],
    });

    // No secrets should appear in the event payload
    const payloadStr = JSON.stringify(composioEvent?.payload ?? {});
    expect(payloadStr).not.toContain("apiKey");
    expect(payloadStr).not.toContain("secret");
    expect(payloadStr).not.toContain("token");
  });

  /**
   * BT-006 (regression): When agent has empty toolkit slugs (today's scenario),
   * the generate call is identical to the pre-Phase-5 shape — sandbox + runtimeMode,
   * no tools key.
   */
  test("BT-006 (regression): empty toolkit agent run → generate called without tools key, behavior identical to pre-Phase-5", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: [] });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    // Has sandbox context in options
    expect(call?.options?.sandbox).toBeDefined();
    // Has runtimeMode set
    expect(call?.options?.runtimeMode).toBe("classic");
    // No tools key (undefined = not passed = pre-Phase-5 behavior)
    expect(call?.tools).toBeUndefined();

    // Run completed successfully
    const statusCalls = updateBackgroundAgentRunStatus.mock.calls.map(
      ([input]: [StatusUpdateInput]) => input.status,
    );
    expect(statusCalls).toContain("succeeded");
  });

  /**
   * BT-007 (#798): resolver returns off/no_slugs_selected → a named event is
   * recorded instead of the current silent no-op.
   */
  test("BT-007: off outcome (no_slugs_selected) emits background-agent.composio.off", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["gmail"],
      builtinToolNames: null,
    });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "off" as const,
      reason: "no_slugs_selected",
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const offEvent = recordedEvent("background-agent.composio.off");
    expect(offEvent).toBeDefined();
    expect(offEvent?.payload).toMatchObject({ reason: "no_slugs_selected" });
    expect(offEvent?.level).toBe("warn");
    // Non-fatal: the run itself still succeeds.
    expect(offEvent?.status).toBe("succeeded");
  });

  /**
   * BT-008 (#798): resolver returns off/repo_policy_blocked with blockedSlugs
   * → the event payload includes reason and blockedSlugs.
   */
  test("BT-008: off outcome (repo_policy_blocked) emits background-agent.composio.off with blockedSlugs", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["gmail"],
      builtinToolNames: null,
    });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "off" as const,
      reason: "repo_policy_blocked",
      blockedSlugs: ["gmail"],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const offEvent = recordedEvent("background-agent.composio.off");
    expect(offEvent).toBeDefined();
    expect(offEvent?.payload).toMatchObject({
      reason: "repo_policy_blocked",
      blockedSlugs: ["gmail"],
    });
  });

  /**
   * BT-009 (#798): resolver returns status "error" → the recorded event now
   * includes a non-null errorKind (previously omitted entirely).
   */
  test("BT-009: error outcome includes errorKind on the recorded event", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["gmail"],
      builtinToolNames: null,
    });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "error" as const,
      errorKind: "composio_missing_api_key",
      message: "Composio tools selected but COMPOSIO_API_KEY is not configured.",
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const errorEvent = recordedEvent("background-agent.composio.error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorKind).toBe("composio_missing_api_key");
  });

  /**
   * BT-010 (#798): resolver returns ready with non-empty disconnectedToolkits
   * → a new background-agent.composio.not_connected event is recorded naming
   * the disconnected toolkits, distinct from the .resolved event.
   */
  test("BT-010: ready outcome with disconnectedToolkits emits background-agent.composio.not_connected", async () => {
    currentAgent = buildAgent({
      composioToolkitSlugs: ["github", "slack"],
      builtinToolNames: null,
    });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "ready" as const,
      tools: fakeComposioTools,
      toolkitSlugs: ["github", "slack"],
      disconnectedToolkits: ["slack"],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const notConnectedEvent = recordedEvent(
      "background-agent.composio.not_connected",
    );
    expect(notConnectedEvent).toBeDefined();
    expect(notConnectedEvent?.payload).toMatchObject({
      disconnectedToolkits: ["slack"],
    });
    expect(notConnectedEvent?.level).toBe("warn");

    // The .resolved event still fires — not_connected is additive, not a replacement.
    const resolvedEvent = recordedEvent("background-agent.composio.resolved");
    expect(resolvedEvent).toBeDefined();
  });
});
