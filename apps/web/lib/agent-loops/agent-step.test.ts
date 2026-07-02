/**
 * Agent Loops — agent_step executor tests (M1-05) — TDD RED
 *
 * Full mocked test matrix for executeAgentStep:
 *
 * Happy path:
 *   BT-S01: happy path — sandbox connected, agent runs, output JSON read, commit, success
 *   BT-S02: no changes — agent runs but no file changes → skip commit, still success
 *
 * Output contract failures:
 *   BT-S03: output JSON missing → step_output_invalid
 *   BT-S04: output JSON unparseable → step_output_invalid
 *   BT-S05: output oversized (>64KB) → step_output_invalid
 *   BT-S06: output fails node outputSchema → step_output_invalid
 *
 * Check command:
 *   BT-S07: checkCommand passes → success
 *   BT-S08: checkCommand fails (non-zero) → checks_failed with exit code in payload
 *
 * Access / token failures:
 *   BT-S09: no_installation → installation_missing typed failure
 *   BT-S10: permission_missing → permission_missing typed failure
 *
 * Sandbox failures:
 *   BT-S11: connectSandbox throws → sandbox_unavailable typed failure
 *
 * Timeout:
 *   BT-S12: openAgent throws AbortError (timeout) → typed failure with timeout info
 *
 * Disposal:
 *   BT-S13: sandbox stop() called on SUCCESS path
 *   BT-S14: sandbox stop() called on FAILURE path (output missing)
 *   BT-S15: sandbox stop() called when sandbox connect succeeds but agent throws
 *
 * Redaction:
 *   BT-S16: installation token never appears in any event payload or step output
 *   BT-S17: prompt content (which may echo token via buildLoopStepPrompt) never persisted in events
 *
 * Events:
 *   BT-S18: agent-loop.step.sandbox.started emitted with sandboxName + correlation
 *   BT-S19: agent-loop.step.agent.completed emitted with usage summary
 *   BT-S20: agent-loop.step.commit.completed emitted with branch + sha on commit path
 *   BT-S21: agent-loop.step.check.completed emitted when checkCommand runs
 *
 * Push uses executor not agent:
 *   BT-S22: commit/push done by executor (via commit helpers), not by agent instructions
 *
 * Context output:
 *   BT-S23: validated output merged into run context via updateAgentLoopRunContext
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Recorded call captures ────────────────────────────────────────────────────

type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
  requestId?: string | null;
  workflowRunId?: string | null;
};

type StepUpdateInput = {
  stepRunId: string;
  status?: string;
  stepOutput?: Record<string, unknown> | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  sandboxName?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
};

type RunContextInput = {
  runId: string;
  context: Record<string, unknown>;
};

let recordedEvents: EventInput[] = [];
let recordedStepUpdates: StepUpdateInput[] = [];
let recordedContextUpdates: RunContextInput[] = [];

// ── Store mocks ───────────────────────────────────────────────────────────────

let currentStepRun: AgentLoopStepRun;
let currentLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;

const updateAgentLoopStepRunMock = mock(
  async (input: StepUpdateInput): Promise<AgentLoopStepRun> => {
    recordedStepUpdates.push(input);
    return { ...currentStepRun, ...(input as Partial<AgentLoopStepRun>) };
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: "evt-1", ...input };
});

const updateAgentLoopRunContextMock = mock(async (input: RunContextInput) => {
  recordedContextUpdates.push(input);
  return { ...currentLoopRun, context: input.context };
});

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: mock(async (_stepRunId: string) => ({
    stepRun: currentStepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  })),
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  updateAgentLoopRunStatus: mock(async () => ({})),
  updateAgentLoopRunContext: updateAgentLoopRunContextMock,
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

// ── GitHub access + app mocks ─────────────────────────────────────────────────

let verifyRepoAccessResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  defaultBranch?: string;
  reason?: string;
} = {
  ok: true,
  installationId: 42,
  repositoryId: 7,
  defaultBranch: "main",
};

const verifyRepoAccessMock = mock(async () => verifyRepoAccessResult);

let mintInstallationTokenResult: { token: string } = {
  token: "ghs_SHOULD_NOT_APPEAR_IN_EVENTS",
};
const mintInstallationTokenMock = mock(async () => mintInstallationTokenResult);
const revokeInstallationTokenMock = mock(async () => undefined);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessMock,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mintInstallationTokenMock,
  revokeInstallationToken: revokeInstallationTokenMock,
  withScopedInstallationOctokit: mock(
    async (params: {
      installationId: number;
      repositoryId: number;
      permissions: Record<string, string>;
      operation: (octokit: unknown) => Promise<unknown>;
    }) => params.operation({ rest: {} }),
  ),
}));

// ── Sandbox mock ──────────────────────────────────────────────────────────────

let sandboxConnectShouldThrow: Error | null = null;

// Per-test outputs for sandbox.readFile and sandbox.exec
let sandboxReadFileResult: string | Error = JSON.stringify({ result: "done" });
let sandboxExecResult: {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
} = { success: true, exitCode: 0, stdout: "ok", stderr: "", truncated: false };

const sandboxMock = {
  type: "cloud" as const,
  workingDirectory: "/vercel/sandbox/acme-my-repo",
  currentBranch: "main",
  environmentDetails: "Vercel sandbox",
  host: "sandbox.vercel.app",
  getState: () => ({
    type: "vercel",
    sandboxName: "agent_loop_step-run-1",
    source: {
      repo: "https://github.com/acme/my-repo.git",
      branch: "main",
    },
  }),
  readFile: mock(async (_path: string, _enc: "utf-8") => {
    if (sandboxReadFileResult instanceof Error) {
      throw sandboxReadFileResult;
    }
    return sandboxReadFileResult;
  }),
  exec: mock(
    async (
      _command: string,
      _cwd: string,
      _timeout: number,
      _options?: { signal?: AbortSignal },
    ) => {
      return sandboxExecResult;
    },
  ),
  stop: mock(async () => undefined),
  writeFile: mock(async () => undefined),
  stat: mock(async () => ({
    isDirectory: () => false,
    isFile: () => true,
    size: 0,
    mtimeMs: 0,
  })),
  access: mock(async () => undefined),
  mkdir: mock(async () => undefined),
  readdir: mock(async () => []),
};

const connectSandboxMock = mock(async (_config: unknown) => {
  if (sandboxConnectShouldThrow) {
    throw sandboxConnectShouldThrow;
  }
  return sandboxMock;
});

// Sandbox git helpers
let hasUncommittedChangesResult = true;

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxMock,
  hasUncommittedChanges: mock(async () => hasUncommittedChangesResult),
  stageAll: mock(async () => undefined),
  getCurrentBranch: mock(async () => "main"),
  getHeadSha: mock(async () => "abc123sha"),
  getStagedDiff: mock(async () => "diff --git a/file.ts\n+changed"),
  getChangedFiles: mock(async () =>
    hasUncommittedChangesResult
      ? [{ path: "src/file.ts", status: "modified" }]
      : [],
  ),
  getFileModes: mock(async () => new Map([["src/file.ts", "100644"]])),
  detectBinaryFiles: mock(async () => new Map()),
  readFileContents: mock(async () => []),
  syncToRemote: mock(async () => undefined),
  withTemporaryGitHubAuth: mock(
    async (_sandbox: unknown, _token: string, fn: () => Promise<void>) => fn(),
  ),
}));

// ── openAgent mock ────────────────────────────────────────────────────────────

let openAgentShouldThrow: Error | null = null;
let openAgentResult = {
  finishReason: "stop" as const,
  rawFinishReason: "end_turn",
  steps: [{ toolCalls: [] }],
  response: { messages: [] },
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  totalUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
};

const openAgentGenerateMock = mock(async (_params: unknown) => {
  if (openAgentShouldThrow) {
    throw openAgentShouldThrow;
  }
  return openAgentResult;
});

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  openAgent: {
    generate: openAgentGenerateMock,
  },
  gateway: mock((model: string) => model),
}));

// ── Commit mocks ──────────────────────────────────────────────────────────────

let commitIntentResult: {
  ok: boolean;
  intent?: unknown;
  error?: string;
  empty?: boolean;
} = {
  ok: true,
  intent: {
    owner: "acme",
    repo: "my-repo",
    repositoryId: 7,
    installationId: 42,
    branch: "main",
    expectedHeadSha: "abc123sha",
    message: "chore: agent_step changes",
    files: [{ path: "src/file.ts", status: "modified" }],
  },
};

const buildCommitIntentFromSandboxMock = mock(async () => commitIntentResult);

const createCommitMock = mock(async () => ({
  ok: true,
  commitSha: "def456sha",
}));

const buildCoAuthorMock = mock(async () => ({
  name: "testuser",
  email: "12345+testuser@users.noreply.github.com",
}));

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: buildCommitIntentFromSandboxMock,
}));

mock.module("@/lib/github/commit", () => ({
  createCommit: createCommitMock,
  buildCoAuthor: buildCoAuthorMock,
}));

// ── Sandbox config mock ───────────────────────────────────────────────────────

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: undefined,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgentStepNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-node-1",
    kind: "agent_step",
    label: "Implement",
    position: { x: 0, y: 0 },
    instructions: "Do the work",
    ...overrides,
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-run-1",
    loopRunId: "loop-run-1",
    nodeId: "agent-node-1",
    nodeKind: "agent_step",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-run-1",
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "loop-run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running",
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-run-1",
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "my-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {
      github: { contents: "write" },
    },
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function resetMocks() {
  recordedEvents = [];
  recordedStepUpdates = [];
  recordedContextUpdates = [];

  sandboxConnectShouldThrow = null;
  sandboxReadFileResult = JSON.stringify({ result: "done" });
  sandboxExecResult = {
    success: true,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    truncated: false,
  };

  verifyRepoAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 7,
    defaultBranch: "main",
  };
  mintInstallationTokenResult = { token: "ghs_SHOULD_NOT_APPEAR_IN_EVENTS" };

  openAgentShouldThrow = null;
  openAgentResult = {
    finishReason: "stop",
    rawFinishReason: "end_turn",
    steps: [{ toolCalls: [] }],
    response: { messages: [] },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    totalUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  };

  hasUncommittedChangesResult = true;

  commitIntentResult = {
    ok: true,
    intent: {
      owner: "acme",
      repo: "my-repo",
      repositoryId: 7,
      installationId: 42,
      branch: "main",
      expectedHeadSha: "abc123sha",
      message: "chore: agent_step changes",
      files: [{ path: "src/file.ts", status: "modified" }],
    },
  };

  // Reset mock call counts
  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  updateAgentLoopRunContextMock.mockClear();
  verifyRepoAccessMock.mockClear();
  mintInstallationTokenMock.mockClear();
  revokeInstallationTokenMock.mockClear();
  connectSandboxMock.mockClear();
  sandboxMock.readFile.mockClear();
  sandboxMock.exec.mockClear();
  sandboxMock.stop.mockClear();
  openAgentGenerateMock.mockClear();
  buildCommitIntentFromSandboxMock.mockClear();
  createCommitMock.mockClear();
  buildCoAuthorMock.mockClear();
}

// Import after mocks
const { executeAgentStep } = await import("./agent-step");

// ── BT-S01: Happy path ────────────────────────────────────────────────────────

describe("BT-S01: happy path — sandbox, agent, output JSON, commit", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S01: returns outcome success", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
  });

  test("BT-S01: runs the agent in unattended mode so approval-gated calls cannot wedge the run", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const call = openAgentGenerateMock.mock.calls[0]?.[0] as {
      options?: { unattended?: boolean; allowedBuiltinToolNames?: unknown };
    };
    expect(call?.options?.unattended).toBe(true);
    // No allowlist configured on the node → default policy (null).
    expect(call?.options?.allowedBuiltinToolNames).toBeNull();
  });

  test("BT-S01: forwards the node's builtinToolNames allowlist to the agent", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode({
        builtinToolNames: ["read", "grep", "bash"],
      }) as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const call = openAgentGenerateMock.mock.calls[0]?.[0] as {
      options?: { allowedBuiltinToolNames?: string[] };
    };
    expect(call?.options?.allowedBuiltinToolNames).toEqual([
      "read",
      "grep",
      "bash",
    ]);
  });

  test("BT-S01: sandbox named agent_loop_<stepRunId> is connected", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(connectSandboxMock.mock.calls.length).toBe(1);
    const config = connectSandboxMock.mock.calls[0]?.[0] as {
      state?: { sandboxName?: string };
    };
    expect(config?.state?.sandboxName).toBe("agent_loop_step-run-1");
  });

  test("BT-S01: step output from output JSON merged into run context", async () => {
    sandboxReadFileResult = JSON.stringify({
      result: "done",
      branch: "feat/step-1",
    });

    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(recordedContextUpdates.length).toBeGreaterThan(0);
    const ctxUpdate = recordedContextUpdates[0];
    expect(ctxUpdate).toBeDefined();
    const nodeCtx = (ctxUpdate!.context as Record<string, unknown>)[
      "agent-node-1"
    ];
    expect(nodeCtx).toBeDefined();
  });

  test("BT-S01: stepOutput persisted on step run", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    expect(succeededUpdate).toBeDefined();
    expect(succeededUpdate?.stepOutput).toBeDefined();
  });
});

// ── BT-S02: No changes — skip commit ─────────────────────────────────────────

describe("BT-S02: no file changes — skip commit, still success", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S02: returns success when no file changes", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
  });

  test("BT-S02: commit helpers NOT called when no file changes", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(buildCommitIntentFromSandboxMock.mock.calls.length).toBe(0);
    expect(createCommitMock.mock.calls.length).toBe(0);
  });
});

// ── BT-S03: Output JSON missing ───────────────────────────────────────────────

describe("BT-S03: output JSON missing → step_output_invalid", () => {
  beforeEach(() => {
    resetMocks();
    // Simulate file not found
    sandboxReadFileResult = new Error(
      "ENOENT: /tmp/loop-step-output.json not found",
    );
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S03: missing output file → step_output_invalid failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });
});

// ── BT-S04: Output JSON unparseable ──────────────────────────────────────────

describe("BT-S04: output JSON unparseable → step_output_invalid", () => {
  beforeEach(() => {
    resetMocks();
    sandboxReadFileResult = "this is not valid { json }";
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S04: invalid JSON in output file → step_output_invalid failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });
});

// ── BT-S05: Output oversized ──────────────────────────────────────────────────

describe("BT-S05: output oversized (>64KB) → step_output_invalid", () => {
  beforeEach(() => {
    resetMocks();
    // Build a string that when serialized will exceed 64KB
    const bigValue = "x".repeat(70 * 1024);
    sandboxReadFileResult = JSON.stringify({ bigField: bigValue });
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S05: oversized output → step_output_invalid failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });
});

// ── BT-S06: Output fails outputSchema ────────────────────────────────────────

describe("BT-S06: output fails node outputSchema → step_output_invalid", () => {
  beforeEach(() => {
    resetMocks();
    // Output JSON is valid but missing required field from schema
    sandboxReadFileResult = JSON.stringify({ wrongField: "value" });
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S06: output fails outputSchema → step_output_invalid failure", async () => {
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: {
        type: "object",
        required: ["requiredField"],
        properties: {
          requiredField: { type: "string" },
        },
      },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });

  test("BT-S06: output passes outputSchema → success", async () => {
    sandboxReadFileResult = JSON.stringify({ requiredField: "hello" });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: {
        type: "object",
        required: ["requiredField"],
        properties: {
          requiredField: { type: "string" },
        },
      },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
  });
});

// ── BT-S07: checkCommand passes ───────────────────────────────────────────────

describe("BT-S07: checkCommand passes → success", () => {
  beforeEach(() => {
    resetMocks();
    sandboxExecResult = {
      success: true,
      exitCode: 0,
      stdout: "All tests passed",
      stderr: "",
      truncated: false,
    };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S07: checkCommand exit 0 → success", async () => {
    const nodeWithCheck = makeAgentStepNode({ checkCommand: "bun test" });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithCheck as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
    // Sandbox exec was called for the checkCommand
    expect(sandboxMock.exec.mock.calls.length).toBeGreaterThan(0);
  });
});

// ── BT-S08: checkCommand fails ────────────────────────────────────────────────

describe("BT-S08: checkCommand fails (non-zero) → checks_failed", () => {
  beforeEach(() => {
    resetMocks();
    sandboxExecResult = {
      success: false,
      exitCode: 1,
      stdout: "3 tests failed",
      stderr: "assertion error",
      truncated: false,
    };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S08: checkCommand non-zero exit → checks_failed failure", async () => {
    const nodeWithCheck = makeAgentStepNode({ checkCommand: "bun test" });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithCheck as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("checks_failed");
  });

  test("BT-S08: checks_failed event payload includes exit code", async () => {
    const nodeWithCheck = makeAgentStepNode({ checkCommand: "bun test" });

    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithCheck as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // Find the event about check completion
    const checkEvent = recordedEvents.find(
      (e) =>
        e.eventName === "agent-loop.step.check.completed" ||
        (e.eventName === "agent-loop.step.failed" &&
          (e.payload as Record<string, unknown> | undefined)?.["errorKind"] ===
            "checks_failed"),
    );
    expect(checkEvent).toBeDefined();
  });
});

// ── BT-S09: no_installation ───────────────────────────────────────────────────

describe("BT-S09: no_installation → installation_missing", () => {
  beforeEach(() => {
    resetMocks();
    verifyRepoAccessResult = { ok: false, reason: "no_installation" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S09: no_installation → installation_missing typed failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("installation_missing");
    // Sandbox must NOT be connected — no access
    expect(connectSandboxMock.mock.calls.length).toBe(0);
  });
});

// ── BT-S10: permission_missing ───────────────────────────────────────────────

describe("BT-S10: user_no_access → permission_missing", () => {
  beforeEach(() => {
    resetMocks();
    verifyRepoAccessResult = { ok: false, reason: "user_no_access" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S10: user_no_access → permission_missing typed failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("permission_missing");
  });
});

// ── BT-S11: Sandbox connect failure ──────────────────────────────────────────

describe("BT-S11: connectSandbox throws → sandbox_unavailable", () => {
  beforeEach(() => {
    resetMocks();
    sandboxConnectShouldThrow = new Error("Sandbox quota exceeded");
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S11: connectSandbox throws → sandbox_unavailable typed failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("sandbox_unavailable");
  });
});

// ── BT-S12: Timeout (openAgent throws) ───────────────────────────────────────

describe("BT-S12: openAgent timeout → typed failure", () => {
  beforeEach(() => {
    resetMocks();
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    openAgentShouldThrow = abortError;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S12: openAgent AbortError → step fails with timeout-related error", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    // Timeout is a workflow_failed or agent_timeout kind
    expect(result.errorKind).toBeDefined();
    expect(result.errorKind).not.toBe("not_implemented");
  });
});

// ── BT-S13/S14/S15: Disposal asserts ─────────────────────────────────────────

describe("BT-S13/S14/S15: sandbox disposal on every path", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S13: sandbox stop() called on SUCCESS path", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(sandboxMock.stop.mock.calls.length).toBe(1);
  });

  test("BT-S14: sandbox stop() called on FAILURE path (missing output)", async () => {
    sandboxReadFileResult = new Error("ENOENT: file not found");

    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(sandboxMock.stop.mock.calls.length).toBe(1);
  });

  test("BT-S15: sandbox stop() called when agent throws", async () => {
    openAgentShouldThrow = new Error("Agent exploded");

    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(sandboxMock.stop.mock.calls.length).toBe(1);
  });
});

// ── BT-S16/S17: Redaction ────────────────────────────────────────────────────

describe("BT-S16/S17: token never appears in events or step output", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S16: installation token not present in any event payload", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const tokenValue = mintInstallationTokenResult.token;
    for (const event of recordedEvents) {
      const serialized = JSON.stringify(event.payload ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });

  test("BT-S17: stepOutput does not contain raw installation token", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const tokenValue = mintInstallationTokenResult.token;
    for (const update of recordedStepUpdates) {
      const serialized = JSON.stringify(update.stepOutput ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });
});

// ── BT-S18/S19/S20/S21: Events ───────────────────────────────────────────────

describe("BT-S18: agent-loop.step.sandbox.started emitted", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S18: sandbox.started event emitted with sandboxName + correlation", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const sandboxEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.sandbox.started",
    );
    expect(sandboxEvent).toBeDefined();
    expect(sandboxEvent?.loopRunId).toBe("loop-run-1");
    expect(sandboxEvent?.stepRunId).toBe("step-run-1");
    const payload = sandboxEvent?.payload as Record<string, unknown>;
    expect(payload?.["sandboxName"]).toContain("agent_loop_");
  });
});

describe("BT-S19: agent-loop.step.agent.completed emitted with usage", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S19: agent.completed event emitted with usage summary", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const agentEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.agent.completed",
    );
    expect(agentEvent).toBeDefined();
    const payload = agentEvent?.payload as Record<string, unknown>;
    // Usage summary should be present
    expect(payload?.["usage"]).toBeDefined();
  });
});

describe("BT-S20: agent-loop.step.commit.completed emitted on commit", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
    hasUncommittedChangesResult = true;
  });

  test("BT-S20: commit.completed event emitted with branch + sha", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const commitEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.commit.completed",
    );
    expect(commitEvent).toBeDefined();
    const payload = commitEvent?.payload as Record<string, unknown>;
    expect(payload?.["branch"]).toBeDefined();
    expect(payload?.["sha"]).toBeDefined();
  });
});

describe("BT-S21: agent-loop.step.check.completed emitted for checkCommand", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S21: check.completed event emitted when checkCommand runs", async () => {
    const nodeWithCheck = makeAgentStepNode({ checkCommand: "bun test" });

    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithCheck as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const checkEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.check.completed",
    );
    expect(checkEvent).toBeDefined();
    const payload = checkEvent?.payload as Record<string, unknown>;
    expect(payload?.["exitCode"]).toBeDefined();
    expect(typeof payload?.["durationMs"]).toBe("number");
  });
});

// ── BT-S22: Push uses executor, not agent ─────────────────────────────────────

describe("BT-S22: executor handles commit/push, not the agent", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
    hasUncommittedChangesResult = true;
  });

  test("BT-S22: createCommit called by executor, not by the agent prompt", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // createCommit is called by the executor infrastructure
    expect(createCommitMock.mock.calls.length).toBe(1);
  });
});

// ── BT-S23: Branch declaration convention ────────────────────────────────────

describe("BT-S23: branch from output JSON field 'branch'", () => {
  beforeEach(() => {
    resetMocks();
    // Agent writes branch to output JSON
    sandboxReadFileResult = JSON.stringify({
      result: "done",
      branch: "feat/agent-step-branch",
    });
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
    hasUncommittedChangesResult = true;
  });

  test("BT-S23: branch declared in output JSON used for commit/push", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // buildCommitIntentFromSandbox was called with the branch from output JSON
    expect(buildCommitIntentFromSandboxMock.mock.calls.length).toBe(1);
    const allCalls = buildCommitIntentFromSandboxMock.mock.calls as unknown as [
      Record<string, unknown>,
    ][];
    const callArgs = allCalls[0]?.[0] ?? {};
    expect(callArgs["branch"]).toBe("feat/agent-step-branch");
  });
});

// ── BT-S24: Flat-map outputSchema validation (#766) ──────────────────────────
//
// Shape-detection rule (pinned here, documented on the detector in
// output-refs.ts / agent-step.ts): an outputSchema object where EVERY value
// is a string type-name ("string"|"number"|"boolean"|"object"|"array") is a
// flat map — every declared key is required + type-checked. Anything else
// (e.g. presence of "properties"/"type" as JSON-Schema-Lite marker keys with
// non-string-type-name values) is JSON-Schema-Lite — current semantics
// unchanged.

describe("BT-S24: flat-map outputSchema — every declared key required + type-checked", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S24a: flat-map schema, missing declared key → step_output_invalid", async () => {
    sandboxReadFileResult = JSON.stringify({ notes: "looks good" });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: { passed: "boolean", notes: "string" },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });

  test("BT-S24b: flat-map schema, wrong type on declared key → step_output_invalid", async () => {
    sandboxReadFileResult = JSON.stringify({ passed: "yes", notes: "ok" });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: { passed: "boolean", notes: "string" },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
  });

  test("BT-S24c: flat-map schema, all declared keys present + correctly typed → success", async () => {
    sandboxReadFileResult = JSON.stringify({ passed: true, notes: "ok" });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: { passed: "boolean", notes: "string" },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
  });

  test("BT-S24d: JSON-Schema-Lite shape behavior is unchanged (extra undeclared keys allowed)", async () => {
    // Regression guard: a JSON-Schema-Lite schema only enforces `required` +
    // `properties` types — it must NOT be reinterpreted as a flat map.
    sandboxReadFileResult = JSON.stringify({
      requiredField: "hello",
      extra: "unrelated",
    });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: {
        type: "object",
        required: ["requiredField"],
        properties: {
          requiredField: { type: "string" },
        },
      },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
  });

  test("BT-S24e: flat-map schema with $-prefixed metadata key (e.g. $schema) does not demand a literal $schema output field", async () => {
    // Regression guard: isFlatOutputSchema deliberately EXCLUDES $-prefixed
    // keys when classifying a schema as flat (see output-schema-shape.ts).
    // The flat-map validator must be consistent and also skip $-keys —
    // otherwise a schema like {"$schema": "https://...", "passed": "boolean"}
    // is classified as flat but then always fails validation because the
    // agent output never contains a literal "$schema" field.
    sandboxReadFileResult = JSON.stringify({ passed: true });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: {
        $schema: "https://example.com/schema",
        passed: "boolean",
      },
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
    expect(result.errorKind).toBeUndefined();
  });
});

// ── BT-S25: stepTimeoutMs plumbing (#766) ────────────────────────────────────

describe("BT-S25: configurable stepTimeoutMs is passed to the agent invocation", () => {
  beforeEach(() => {
    resetMocks();
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-S25a: explicit stepTimeoutMs param is forwarded to openAgent.generate's timeout", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
      stepTimeoutMs: 5 * 60 * 1000,
    });

    const call = openAgentGenerateMock.mock.calls[0]?.[0] as {
      timeout?: { totalMs?: number };
    };
    expect(call?.timeout?.totalMs).toBe(5 * 60 * 1000);
  });

  test("BT-S25b: omitted stepTimeoutMs falls back to the 10-minute default", async () => {
    await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const call = openAgentGenerateMock.mock.calls[0]?.[0] as {
      timeout?: { totalMs?: number };
    };
    expect(call?.timeout?.totalMs).toBe(10 * 60 * 1000);
  });

  test("BT-S25c: stepTimeoutMs budget is cumulative across the tool-call loop, not reset per call", async () => {
    // Regression guard: executeAgentStep loops openAgent.generate up to
    // AGENT_MAX_LOOP_STEPS times while finishReason is "tool-calls". Each
    // call must be given the REMAINING budget against a single deadline
    // computed before the loop, not the full configured stepTimeoutMs again —
    // otherwise an 8-step loop at stepTimeoutMs=X can run up to 8x.
    const stepTimeoutMs = 30 * 60 * 1000; // 30 minutes, per the finding

    // First 3 calls request more tool calls; 4th call stops. Each call sleeps
    // briefly so real wall-clock time elapses between calls — this is what
    // makes a cumulative (single-deadline) budget observably different from
    // a per-call reset budget in the assertions below.
    let callCount = 0;
    openAgentGenerateMock.mockImplementation(async (_params: unknown) => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (callCount < 4) {
        return {
          finishReason: "tool-calls" as const,
          rawFinishReason: "tool_use",
          steps: [{ toolCalls: [{ toolCallId: `call-${callCount}` }] }],
          response: { messages: [] },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }
      return {
        finishReason: "stop" as const,
        rawFinishReason: "end_turn",
        steps: [{ toolCalls: [] }],
        response: { messages: [] },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await executeAgentStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
      loopRunId: "loop-run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
      stepTimeoutMs,
    });

    expect(result.outcome).toBe("success");
    expect(openAgentGenerateMock.mock.calls.length).toBe(4);

    const totalMsPerCall = openAgentGenerateMock.mock.calls.map((call) => {
      const params = call[0] as { timeout?: { totalMs?: number } };
      return params?.timeout?.totalMs ?? 0;
    });

    // Every call's budget must be within the configured ceiling...
    for (const totalMs of totalMsPerCall) {
      expect(totalMs).toBeLessThanOrEqual(stepTimeoutMs);
      expect(totalMs).toBeGreaterThan(0);
    }

    // ...and strictly decreasing across successive calls: the mock sleeps
    // between calls, so a cumulative (single-deadline) budget must shrink
    // measurably. A buggy per-call reset (passing stepTimeoutMs unchanged
    // every time) would keep every call's totalMs identical to the ceiling,
    // which this asserts against.
    for (let i = 1; i < totalMsPerCall.length; i++) {
      expect(totalMsPerCall[i]).toBeLessThan(totalMsPerCall[i - 1]);
    }
    expect(totalMsPerCall[totalMsPerCall.length - 1]).toBeLessThan(
      stepTimeoutMs,
    );
  });
});
