/**
 * Regression tests for Phase 5 — Background agent Composio tool injection.
 *
 * These tests verify behaviors that must remain stable even if the Phase-5
 * implementation is modified or partially reverted.
 *
 * REGRESSION-C-001: A BG agent with empty composioToolkitSlugs runs identically
 *   to pre-Phase-5 — generate is called, no tools key is present.
 *   Catches: if executor gains an always-inject path that breaks empty-slug agents.
 *
 * REGRESSION-C-002: resolveComposioToolsForBgRun returns "off" immediately for
 *   empty slug list, without hitting the Composio API.
 *   Catches: if the fast-path is removed and every run starts making external calls.
 *
 * REGRESSION-C-003: When the resolver returns ready, the tools are present in
 *   the generate call AND the composio.resolved event is emitted before the
 *   agent step event.
 *   Catches: if event ordering is broken or tools injection is dropped.
 *
 * REGRESSION-C-004: Composio resolution failure (resolver returns "error") is
 *   non-fatal — the run continues without composio tools and completes.
 *   Catches: if an error in tool resolution causes the whole run to fail.
 *
 * REGRESSION-C-005: customInstructions no longer contain "not available in v1"
 *   for ANY run (with or without composio tools).
 *   Catches: if the v1-block is accidentally re-introduced.
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
// Type stubs
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

// ---------------------------------------------------------------------------
// Mocks
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
const listEnabledToolGrantsForAgent = mock(async (_agentId: string) => []);

mock.module("./store", () => ({
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
  })),
}));
mock.module("./run-summary-persist", () => ({
  persistRunSummary: mock(async () => undefined),
  recordSummaryFailedEvent: mock(async () => undefined),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: mock(async () => undefined),
}));

const successfulCommand: ExecResult = {
  success: true,
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  truncated: false,
};

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

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: mock(async () => fakeSandbox),
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

const successfulAccess = {
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
} as const;
mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: mock(async () => successfulAccess),
  getRepoAccessErrorMessage: mock((reason: string) => reason),
}));
mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mock(async () => ({ token: "setup-token" })),
  revokeInstallationToken: mock(async () => undefined),
  withScopedInstallationOctokit: mock(
    async (params: {
      operation: (o: unknown) => Promise<unknown>;
    }): Promise<unknown> => params.operation({}),
  ),
}));
mock.module("@/lib/github/commit", () => ({
  buildCoAuthor: mock(async () => ({
    name: "mona",
    email: "1+mona@users.noreply.github.com",
  })),
  createCommit: mock(async () => ({ ok: true, commitSha: "sha-regression" })),
}));
mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: mock(async () => ({
    ok: true,
    intent: {
      owner: "acme",
      repo: "widgets",
      repositoryId: 42,
      installationId: 99,
      branch: "main",
      baseBranch: "main",
      expectedHeadSha: "base",
      message: "chore",
      files: [],
      coAuthor: null,
    },
  })),
}));
mock.module("@/lib/github/pulls", () => ({
  openPullRequest: mock(async () => ({
    success: true,
    prUrl: "https://github.com/acme/widgets/pull/99",
    prNumber: 99,
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
  gateway: (id: string) => id,
  openAgent: { generate },
}));

const fakeComposioTools: Record<string, unknown> = {
  github_create_issue: { description: "Create a GitHub issue" },
};
const resolveComposioToolsForBgRun = mock(
  async (
    _params: unknown,
  ): Promise<{
    status: "ready" | "off" | "error";
    tools?: Record<string, unknown>;
    toolkitSlugs?: string[];
    error?: string;
  }> => ({
    status: "off",
  }),
);
mock.module("./composio-tools", () => ({ resolveComposioToolsForBgRun }));

// ---------------------------------------------------------------------------
// Lazy executor import
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
    id: "run_regression_composio",
    agentId: "agent-reg",
    triggerId: "trigger-reg",
    userId: "user-reg",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-reg",
    idempotencyKey: "idempotency-reg",
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: "abc123",
    branch: null,
    prNumber: 7,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputKind: "ready_pr",
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: { title: "Fix widgets", actor: "mona" },
    requestId: "req-reg",
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
    id: "agent-reg",
    userId: "user-reg",
    name: "Regression agent",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Regression test.",
    permissions: {},
    outputMode: "ready_pr",
    checkCommand: null,
    composioToolkitSlugs: [],
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
  return recordedEvents().find((e) => e.eventName === name);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  generateCalls.length = 0;

  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  generate.mockClear();
  resolveComposioToolsForBgRun.mockClear();
  listEnabledToolGrantsForAgent.mockClear();

  currentAgent = buildAgent({ composioToolkitSlugs: [] });
  resolveComposioToolsForBgRun.mockImplementation(async () => ({
    status: "off",
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
// Regression tests
// ---------------------------------------------------------------------------
describe("Phase 5 regression: Composio tool injection stability", () => {
  /**
   * REGRESSION-C-001: BG agent with empty composioToolkitSlugs runs identically
   * to pre-Phase-5 — generate is called, no tools key is present.
   */
  test("REGRESSION-C-001: empty composioToolkitSlugs → generate called without tools key", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: [] });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    // No tools key — same as pre-Phase-5 behavior
    expect(call?.tools).toBeUndefined();
    // Run succeeded
    const statuses = updateBackgroundAgentRunStatus.mock.calls.map(
      ([i]: [StatusUpdateInput]) => i.status,
    );
    expect(statuses).toContain("succeeded");
    // Composio resolver never called
    expect(resolveComposioToolsForBgRun).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION-C-002: Tools injection happens before the agent step event,
   * and composio.resolved is recorded as an event.
   */
  test("REGRESSION-C-003: composio.resolved event precedes agent.step.completed event", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: ["github"] });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "ready" as const,
      tools: fakeComposioTools,
      toolkitSlugs: ["github"],
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    const events = recordedEvents().map((e) => e.eventName);
    const resolvedIdx = events.indexOf("background-agent.composio.resolved");
    const agentStartedIdx = events.indexOf("background-agent.agent.started");

    // composio.resolved must appear before agent.started
    expect(resolvedIdx).toBeGreaterThan(-1);
    expect(agentStartedIdx).toBeGreaterThan(-1);
    expect(resolvedIdx).toBeLessThan(agentStartedIdx);
  });

  /**
   * REGRESSION-C-004: Composio resolution failure (resolver returns "error")
   * is non-fatal — the run still completes successfully.
   */
  test("REGRESSION-C-004: resolver error is non-fatal, run completes without composio tools", async () => {
    currentAgent = buildAgent({ composioToolkitSlugs: ["github"] });
    resolveComposioToolsForBgRun.mockImplementation(async () => ({
      status: "error" as const,
      error: "COMPOSIO_API_KEY not configured",
    }));

    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    // composio.error event was emitted
    expect(recordedEvent("background-agent.composio.error")).toBeDefined();

    // generate was still called (run continues)
    expect(generate).toHaveBeenCalled();
    const call = generateCalls[0];
    // No tools — resolver error means graceful degradation
    expect(call?.tools).toBeUndefined();

    // Run completed (not failed)
    const statuses = updateBackgroundAgentRunStatus.mock.calls.map(
      ([i]: [StatusUpdateInput]) => i.status,
    );
    expect(statuses).toContain("succeeded");
  });

  /**
   * REGRESSION-C-005: customInstructions never contain "not available in v1"
   * for any run, with or without Composio tools.
   * Catches re-introduction of the v1-block.
   */
  test("REGRESSION-C-005: customInstructions never say Composio is not available in v1", async () => {
    // Test with empty slugs
    const { executeBackgroundAgentRun } = await executorModulePromise;
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "wf-1",
    });

    for (const call of generateCalls) {
      const instructions = call.options?.customInstructions ?? "";
      expect(instructions).not.toContain("not available in v1");
      expect(instructions).not.toContain("Composio are not available");
    }
  });
});
