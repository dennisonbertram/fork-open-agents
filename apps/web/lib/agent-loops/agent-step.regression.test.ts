/**
 * Agent Loops — agent_step regression tests (M1-05)
 *
 * Regression coverage for the key behaviors that would break if the
 * implementation in 80bc73a9 were reverted.
 *
 * Each test pinpoints a single behavior that the agent_step executor
 * must always uphold. A revert of the implementation would cause every
 * test here to fail.
 *
 * Protected behaviors:
 *   REG-AS-001: sandbox always disposed (output-contract failure path)
 *   REG-AS-002: step_output_invalid is the ONLY error kind for bad output
 *   REG-AS-003: token never leaks into any event payload
 *   REG-AS-004: missing output file → step_output_invalid (not loop_invalid)
 *   REG-AS-005: checkCommand failure → checks_failed (not step_output_invalid)
 *   REG-AS-006: output branch field propagates to commit intent
 *   REG-AS-007: outputSchema validation catches schema violations
 *   REG-AS-008: sandbox connect failure → sandbox_unavailable (not generic error)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Minimal recorded captures ─────────────────────────────────────────────────

type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
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

let recordedEvents: EventInput[] = [];
let recordedStepUpdates: StepUpdateInput[] = [];
let recordedContextUpdates: {
  runId: string;
  context: Record<string, unknown>;
}[] = [];

let currentStepRun: AgentLoopStepRun;
let currentLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;

const updateStepRunMock = mock(
  async (input: StepUpdateInput): Promise<AgentLoopStepRun> => {
    recordedStepUpdates.push(input);
    return { ...currentStepRun, ...(input as Partial<AgentLoopStepRun>) };
  },
);

const recordEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: "reg-evt-1", ...input };
});

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: mock(async (_id: string) => ({
    stepRun: currentStepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  })),
  updateAgentLoopStepRun: updateStepRunMock,
  recordAgentLoopEvent: recordEventMock,
  updateAgentLoopRunStatus: mock(async () => ({})),
  updateAgentLoopRunContext: mock(
    async (input: { runId: string; context: Record<string, unknown> }) => {
      recordedContextUpdates.push(input);
      return {};
    },
  ),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

// GitHub mocks
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

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: mock(async () => verifyRepoAccessResult),
}));

const mintTokenResult = { token: "ghs_REG_TEST_TOKEN_SHOULD_NOT_LEAK" };

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mock(async () => mintTokenResult),
  revokeInstallationToken: mock(async () => undefined),
  withScopedInstallationOctokit: mock(
    async (params: {
      installationId: number;
      repositoryId: number;
      permissions: Record<string, string>;
      operation: (octokit: unknown) => Promise<unknown>;
    }) => params.operation({ rest: {} }),
  ),
}));

// Sandbox mocks
let sandboxReadFileResult: string | Error = JSON.stringify({ result: "ok" });
let sandboxExecResult = {
  success: true,
  exitCode: 0 as number | null,
  stdout: "ok",
  stderr: "",
  truncated: false,
};
let sandboxConnectShouldThrow: Error | null = null;

const sandboxStopMock = mock(async () => undefined);

const sandboxMock = {
  type: "cloud" as const,
  workingDirectory: "/vercel/sandbox/repo",
  currentBranch: "main",
  environmentDetails: "test",
  host: "test.sandbox",
  getState: () => ({
    type: "vercel",
    sandboxName: "agent_loop_step-1",
    source: { repo: "https://github.com/acme/repo.git", branch: "main" },
  }),
  readFile: mock(async (_p: string, _e: "utf-8") => {
    if (sandboxReadFileResult instanceof Error) throw sandboxReadFileResult;
    return sandboxReadFileResult;
  }),
  exec: mock(async () => sandboxExecResult),
  stop: sandboxStopMock,
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

let hasUncommittedChangesResult = false;

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: mock(async () => {
    if (sandboxConnectShouldThrow) throw sandboxConnectShouldThrow;
    return sandboxMock;
  }),
  hasUncommittedChanges: mock(async () => hasUncommittedChangesResult),
  stageAll: mock(async () => undefined),
  getCurrentBranch: mock(async () => "main"),
  getHeadSha: mock(async () => "headsha123"),
  getStagedDiff: mock(async () => "diff"),
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
    async (_sb: unknown, _tok: string, fn: () => Promise<void>) => fn(),
  ),
}));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  openAgent: {
    generate: mock(async () => ({
      finishReason: "stop",
      rawFinishReason: "end_turn",
      steps: [{ toolCalls: [] }],
      response: { messages: [] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })),
  },
  gateway: mock((m: string) => m),
}));

let buildCommitIntentResult: {
  ok: boolean;
  intent?: unknown;
  error?: string;
  empty?: boolean;
} = {
  ok: true,
  intent: {
    owner: "acme",
    repo: "repo",
    repositoryId: 7,
    installationId: 42,
    branch: "main",
    expectedHeadSha: "headsha123",
    message: "chore: changes",
    files: [{ path: "src/file.ts" }],
  },
};

const buildCommitIntentMock = mock(async () => buildCommitIntentResult);

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: buildCommitIntentMock,
}));

mock.module("@/lib/github/commit", () => ({
  createCommit: mock(async () => ({ ok: true, commitSha: "commitabc" })),
  buildCoAuthor: mock(async () => null),
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: undefined,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-1",
    loopRunId: "run-1",
    nodeId: "agent-1",
    nodeKind: "agent_step",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-1",
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
    id: "run-1",
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
    workflowRunId: "wf-1",
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
    name: "Regression Loop",
    description: null,
    repoOwner: "acme",
    repoName: "repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: { github: { contents: "write" } },
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAgentStepNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    kind: "agent_step" as const,
    label: "Do Work",
    position: { x: 0, y: 0 },
    instructions: "Do the work.",
    ...overrides,
  };
}

function resetAll() {
  recordedEvents = [];
  recordedStepUpdates = [];
  recordedContextUpdates = [];

  sandboxReadFileResult = JSON.stringify({ result: "ok" });
  sandboxExecResult = {
    success: true,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    truncated: false,
  };
  sandboxConnectShouldThrow = null;
  hasUncommittedChangesResult = false;
  verifyRepoAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 7,
    defaultBranch: "main",
  };

  buildCommitIntentResult = {
    ok: true,
    intent: {
      owner: "acme",
      repo: "repo",
      repositoryId: 7,
      installationId: 42,
      branch: "main",
      expectedHeadSha: "headsha123",
      message: "chore: changes",
      files: [{ path: "src/file.ts" }],
    },
  };

  updateStepRunMock.mockClear();
  recordEventMock.mockClear();
  sandboxStopMock.mockClear();
  sandboxMock.readFile.mockClear();
  sandboxMock.exec.mockClear();
  buildCommitIntentMock.mockClear();

  currentStepRun = makeStepRun();
  currentLoopRun = makeLoopRun();
  currentLoop = makeLoop();
}

// Import after mocks
const { executeAgentStep } = await import("./agent-step");

// ── REG-AS-001: Sandbox disposal on output-contract failure ───────────────────

describe("REG-AS-001: sandbox always disposed on output-contract failure", () => {
  beforeEach(() => resetAll());

  test("REG-AS-001: missing output → step_output_invalid AND sandbox.stop() called", async () => {
    sandboxReadFileResult = new Error("ENOENT: file not found");

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // Must fail with correct type
    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
    // CRITICAL: sandbox must always be disposed
    expect(sandboxStopMock.mock.calls.length).toBe(1);
  });
});

// ── REG-AS-002: step_output_invalid for bad output, not other kinds ───────────

describe("REG-AS-002: bad output always maps to step_output_invalid", () => {
  beforeEach(() => resetAll());

  test("REG-AS-002a: invalid JSON → step_output_invalid (not loop_invalid)", async () => {
    sandboxReadFileResult = "{ broken json";

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
    expect(result.errorKind).not.toBe("loop_invalid");
    expect(result.errorKind).not.toBe("github_check_failed");
  });

  test("REG-AS-002b: output exceeds 64KB → step_output_invalid", async () => {
    sandboxReadFileResult = JSON.stringify({ data: "x".repeat(70_000) });

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
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

// ── REG-AS-003: Token never leaks ────────────────────────────────────────────

describe("REG-AS-003: installation token never in event payloads", () => {
  beforeEach(() => resetAll());

  test("REG-AS-003: token value not present in any event payload — even on success", async () => {
    await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const tokenValue = mintTokenResult.token;
    for (const event of recordedEvents) {
      const serialized = JSON.stringify(event.payload ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });

  test("REG-AS-003: token value not present in stepOutput", async () => {
    await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const tokenValue = mintTokenResult.token;
    for (const update of recordedStepUpdates) {
      const serialized = JSON.stringify(update.stepOutput ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });
});

// ── REG-AS-004: missing output → step_output_invalid specifically ─────────────

describe("REG-AS-004: missing output file specifically maps to step_output_invalid", () => {
  beforeEach(() => resetAll());

  test("REG-AS-004: ENOENT → step_output_invalid in step run DB update", async () => {
    sandboxReadFileResult = new Error("ENOENT: /tmp/loop-step-output.json");

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const failedUpdate = recordedStepUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("step_output_invalid");
    expect(result.errorKind).toBe("step_output_invalid");
  });
});

// ── REG-AS-005: checkCommand failure → checks_failed ─────────────────────────

describe("REG-AS-005: checkCommand failure maps to checks_failed", () => {
  beforeEach(() => resetAll());

  test("REG-AS-005: non-zero exit → checks_failed, not step_output_invalid", async () => {
    sandboxExecResult = {
      success: false,
      exitCode: 1,
      stdout: "test failed",
      stderr: "",
      truncated: false,
    };

    const nodeWithCheck = makeAgentStepNode({ checkCommand: "bun test" });

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: nodeWithCheck as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("checks_failed");
    expect(result.errorKind).not.toBe("step_output_invalid");
    // Sandbox still disposed
    expect(sandboxStopMock.mock.calls.length).toBe(1);
  });
});

// ── REG-AS-006: output branch field propagates to commit ─────────────────────

describe("REG-AS-006: branch from output JSON drives commit intent", () => {
  beforeEach(() => {
    resetAll();
    hasUncommittedChangesResult = true;
  });

  test("REG-AS-006: 'branch' field in output JSON → buildCommitIntentFromSandbox called with that branch", async () => {
    sandboxReadFileResult = JSON.stringify({
      result: "done",
      branch: "feat/regression-branch",
    });

    await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(buildCommitIntentMock.mock.calls.length).toBe(1);
    const allCalls = buildCommitIntentMock.mock.calls as unknown as [
      Record<string, unknown>,
    ][];
    const intentArgs = allCalls[0]?.[0] ?? {};
    expect(intentArgs["branch"]).toBe("feat/regression-branch");
  });
});

// ── REG-AS-007: outputSchema validation ──────────────────────────────────────

describe("REG-AS-007: outputSchema validation rejects non-compliant output", () => {
  beforeEach(() => resetAll());

  test("REG-AS-007: output missing required schema field → step_output_invalid", async () => {
    sandboxReadFileResult = JSON.stringify({ optionalField: "present" });
    const nodeWithSchema = makeAgentStepNode({
      outputSchema: {
        type: "object",
        required: ["mandatoryField"],
        properties: { mandatoryField: { type: "string" } },
      },
    });

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: nodeWithSchema as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("step_output_invalid");
    // Sandbox still disposed
    expect(sandboxStopMock.mock.calls.length).toBe(1);
  });
});

// ── REG-AS-008: sandbox connect failure → sandbox_unavailable ─────────────────

describe("REG-AS-008: sandbox connect failure maps to sandbox_unavailable", () => {
  beforeEach(() => resetAll());

  test("REG-AS-008: connectSandbox throws → sandbox_unavailable, not generic workflow_failed", async () => {
    sandboxConnectShouldThrow = new Error("Sandbox quota exceeded");

    const result = await executeAgentStep({
      stepRunId: "step-1",
      workflowRunId: "wf-1",
      loopRunId: "run-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("sandbox_unavailable");
    expect(result.errorKind).not.toBe("workflow_failed");
    expect(result.errorKind).not.toBe("loop_invalid");
  });
});
