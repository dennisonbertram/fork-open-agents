/**
 * Agent Loops — P1 review-fix behavioral tests (TASK-346-P1)
 *
 * TDD RED: All three P1 findings from PR #346 code review.
 *
 * Finding 1 — branch continuity across steps (P1):
 *   BT-346-01: own-node branch (context[nodeId].branch) wins over prior-step branch
 *   BT-346-02: latest prior-step branch (any entry with a non-empty string .branch) is used when no own-node branch
 *   BT-346-03: non-object and missing-branch entries in context are skipped
 *   BT-346-04: fallback to repo defaultBranch when no context branch found
 *
 * Finding 2 — bounded tool-loop until the agent finishes (P1):
 *   BT-346-05: generate returning tool-calls N times then stop → loop continues to completion and output is read
 *   BT-346-06: bound exceeded → typed failure (workflow_failed with clear message)
 *   BT-346-07: step timeout is still enforced (AbortError → workflow_failed)
 *
 * Finding 3 — commit failure must fail the step (P1):
 *   BT-346-08: createCommit returns { ok: false } → step fails with commit_failed errorKind
 *   BT-346-09: createCommit throws → step fails with commit_failed errorKind
 *   BT-346-10: commit failure → sandbox still disposed
 *   BT-346-11: commit failure → agent-loop.step.commit.failed event (not .completed)
 *   BT-346-12: no-changes path is unaffected by commit failure handling (still succeeds)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Recorded call captures ─────────────────────────────────────────────────────

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
  return { id: "p1-evt-1", ...input };
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
  updateAgentLoopRunContext: mock(async () => ({})),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

// ── GitHub access + app mocks ──────────────────────────────────────────────────

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
const mintInstallationTokenMock = mock(async () => ({
  token: "ghs_test_token",
}));
const revokeInstallationTokenMock = mock(async () => undefined);

// withScopedInstallationOctokit — controlled per test via createCommitMock
let createCommitMockResult: {
  ok: boolean;
  commitSha?: string;
  error?: string;
} = { ok: true, commitSha: "sha999" };
let createCommitMockShouldThrow: Error | null = null;

const createCommitMock = mock(async () => {
  if (createCommitMockShouldThrow) {
    throw createCommitMockShouldThrow;
  }
  return createCommitMockResult;
});

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

// ── Sandbox mock ───────────────────────────────────────────────────────────────

let sandboxConnectShouldThrow: Error | null = null;
let sandboxReadFileResult: string | Error = JSON.stringify({ result: "done" });
let hasUncommittedChangesResult = false;

const sandboxStopMock = mock(async () => undefined);

const sandboxMock = {
  type: "cloud" as const,
  workingDirectory: "/vercel/sandbox/repo",
  currentBranch: "main",
  environmentDetails: "test",
  host: "test.sandbox",
  getState: () => ({
    type: "vercel",
    sandboxName: "agent_loop_step-p1-1",
    source: { repo: "https://github.com/acme/repo.git", branch: "main" },
  }),
  readFile: mock(async (_p: string, _e: "utf-8") => {
    if (sandboxReadFileResult instanceof Error) throw sandboxReadFileResult;
    return sandboxReadFileResult;
  }),
  exec: mock(async () => ({
    success: true,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    truncated: false,
  })),
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

const connectSandboxMock = mock(async (_config: unknown) => {
  if (sandboxConnectShouldThrow) throw sandboxConnectShouldThrow;
  return sandboxMock;
});

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxMock,
  hasUncommittedChanges: mock(async () => hasUncommittedChangesResult),
  stageAll: mock(async () => undefined),
  getCurrentBranch: mock(async () => "main"),
  getHeadSha: mock(async () => "abc123sha"),
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

// ── openAgent mock (multi-turn-capable) ────────────────────────────────────────

// Sequence of results to return. Each call pops the first entry.
// When empty, returns the default (stop).
let openAgentResultSequence: Array<{
  finishReason: string;
  rawFinishReason: string;
  steps: Array<{ toolCalls: unknown[] }>;
  response: { messages: unknown[] };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> = [];

let openAgentShouldThrow: Error | null = null;
let openAgentCallCount = 0;

const defaultAgentResult = {
  finishReason: "stop" as const,
  rawFinishReason: "end_turn",
  steps: [{ toolCalls: [] }],
  response: { messages: [] },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

const openAgentGenerateMock = mock(async (_params: unknown) => {
  if (openAgentShouldThrow) {
    throw openAgentShouldThrow;
  }
  openAgentCallCount++;
  if (openAgentResultSequence.length > 0) {
    return openAgentResultSequence.shift()!;
  }
  return defaultAgentResult;
});

mock.module("@open-agents/agent", () => ({
  openAgent: {
    generate: openAgentGenerateMock,
  },
  gateway: mock((model: string) => model),
}));

// ── Commit mocks ───────────────────────────────────────────────────────────────

let commitIntentResult: {
  ok: boolean;
  intent?: Record<string, unknown>;
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
    expectedHeadSha: "abc123sha",
    message: "chore: agent_step changes",
    files: [{ path: "src/file.ts", status: "modified" }],
  },
};

const buildCommitIntentFromSandboxMock = mock(async () => commitIntentResult);
const buildCoAuthorMock = mock(async () => null);

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: buildCommitIntentFromSandboxMock,
}));

mock.module("@/lib/github/commit", () => ({
  createCommit: createCommitMock,
  buildCoAuthor: buildCoAuthorMock,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: undefined,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeAgentStepNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-p1-1",
    kind: "agent_step",
    label: "Work",
    position: { x: 0, y: 0 },
    instructions: "Do the work.",
    ...overrides,
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-p1-1",
    loopRunId: "run-p1-1",
    nodeId: "node-p1-1",
    nodeKind: "agent_step",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-p1-1",
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
    id: "run-p1-1",
    loopId: "loop-p1-1",
    userId: "user-p1-1",
    status: "running",
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-p1-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-p1-1",
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
    id: "loop-p1-1",
    userId: "user-p1-1",
    name: "P1 Test Loop",
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

function resetMocks() {
  recordedEvents = [];
  recordedStepUpdates = [];
  sandboxConnectShouldThrow = null;
  sandboxReadFileResult = JSON.stringify({ result: "done" });
  hasUncommittedChangesResult = false;
  verifyRepoAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 7,
    defaultBranch: "main",
  };
  openAgentShouldThrow = null;
  openAgentResultSequence = [];
  openAgentCallCount = 0;
  createCommitMockResult = { ok: true, commitSha: "sha999" };
  createCommitMockShouldThrow = null;
  commitIntentResult = {
    ok: true,
    intent: {
      owner: "acme",
      repo: "repo",
      repositoryId: 7,
      installationId: 42,
      branch: "main",
      expectedHeadSha: "abc123sha",
      message: "chore: agent_step changes",
      files: [{ path: "src/file.ts", status: "modified" }],
    },
  };

  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  verifyRepoAccessMock.mockClear();
  mintInstallationTokenMock.mockClear();
  revokeInstallationTokenMock.mockClear();
  connectSandboxMock.mockClear();
  sandboxMock.readFile.mockClear();
  sandboxMock.exec.mockClear();
  sandboxStopMock.mockClear();
  openAgentGenerateMock.mockClear();
  buildCommitIntentFromSandboxMock.mockClear();
  createCommitMock.mockClear();
  buildCoAuthorMock.mockClear();
}

// Import AFTER mocks are set up
const { executeAgentStep } = await import("./agent-step");

// ─────────────────────────────────────────────────────────────────────────────
// Finding 1: branch continuity across steps
// ─────────────────────────────────────────────────────────────────────────────

describe("BT-346-01: own-node branch wins over prior-step branch in context", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun({
      // node-p1-1 has its own branch in context — this is a re-run
      // Another node "prior-step" also has a branch
      context: {
        "prior-step": { branch: "feat/prior-step-branch", result: "done" },
        "node-p1-1": { branch: "feat/own-node-branch", result: "prev" },
      },
    });
    currentLoop = makeLoop();
  });

  test("BT-346-01: own-node branch is used for sandbox clone and commit", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // The sandbox should have been connected with own-node's branch
    const connectCall = connectSandboxMock.mock.calls[0]?.[0] as {
      state?: { source?: { branch?: string } };
    };
    expect(connectCall?.state?.source?.branch).toBe("feat/own-node-branch");
  });
});

describe("BT-346-02: latest prior-step branch found via insertion-order scan", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun({
      // No own-node entry. Two prior steps, second added LAST.
      // The last entry in insertion order with a non-empty branch should win.
      context: {
        "step-first": { branch: "feat/first-branch", result: "a" },
        "step-second": { branch: "feat/second-branch", result: "b" },
      },
    });
    currentLoop = makeLoop();
  });

  test("BT-346-02: latest (last insertion-order) prior-step branch is used", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // "step-second" was inserted last, so its branch wins
    const connectCall = connectSandboxMock.mock.calls[0]?.[0] as {
      state?: { source?: { branch?: string } };
    };
    expect(connectCall?.state?.source?.branch).toBe("feat/second-branch");
  });
});

describe("BT-346-03: non-object and missing-branch entries in context are skipped", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun({
      // A mix of non-object entries, entries with empty branch, and one valid entry
      context: {
        "step-string-val": "just-a-string",
        "step-number-val": 42,
        "step-null-val": null,
        "step-empty-branch": { branch: "", result: "x" },
        "step-no-branch": { result: "x" },
        "step-non-string-branch": { branch: 123, result: "x" },
        "step-valid": { branch: "feat/valid-branch", result: "v" },
      },
    });
    currentLoop = makeLoop();
  });

  test("BT-346-03: only the entry with valid non-empty string branch is used", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // Must find "feat/valid-branch" by skipping all the invalid entries
    const connectCall = connectSandboxMock.mock.calls[0]?.[0] as {
      state?: { source?: { branch?: string } };
    };
    expect(connectCall?.state?.source?.branch).toBe("feat/valid-branch");
  });
});

describe("BT-346-04: fallback to repo defaultBranch when no context branch found", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun({
      context: {}, // empty context — no branches
    });
    currentLoop = makeLoop();
    verifyRepoAccessResult = {
      ok: true,
      installationId: 42,
      repositoryId: 7,
      defaultBranch: "develop",
    };
  });

  test("BT-346-04: defaultBranch from access result used when context has no branch", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const connectCall = connectSandboxMock.mock.calls[0]?.[0] as {
      state?: { source?: { branch?: string } };
    };
    expect(connectCall?.state?.source?.branch).toBe("develop");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 2: bounded tool-loop
// ─────────────────────────────────────────────────────────────────────────────

describe("BT-346-05: generate returning tool-calls then stop → loop runs to completion", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();

    // First 2 calls return "tool-calls", 3rd returns "stop"
    openAgentResultSequence = [
      {
        finishReason: "tool-calls",
        rawFinishReason: "tool_use",
        steps: [{ toolCalls: [{ toolName: "bash" }] }],
        response: { messages: [{ role: "assistant", content: "..." }] },
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        totalUsage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      },
      {
        finishReason: "tool-calls",
        rawFinishReason: "tool_use",
        steps: [{ toolCalls: [{ toolName: "read_file" }] }],
        response: { messages: [{ role: "assistant", content: "..." }] },
        usage: { promptTokens: 60, completionTokens: 25, totalTokens: 85 },
        totalUsage: { promptTokens: 60, completionTokens: 25, totalTokens: 85 },
      },
      // Third call returns "stop" — agent is done
    ];
  });

  test("BT-346-05: openAgent.generate called multiple times until finishReason !== tool-calls", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // Must succeed — the loop continued until the agent stopped
    expect(result.outcome).toBe("success");
    // generate should have been called 3 times (2 tool-calls + 1 stop)
    expect(openAgentCallCount).toBe(3);
  });

  test("BT-346-05: output JSON still read after multi-turn agent run", async () => {
    sandboxReadFileResult = JSON.stringify({
      result: "multi-turn-complete",
      branch: "feat/multi-turn",
    });

    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
    // readFile was called to read the output
    expect(sandboxMock.readFile.mock.calls.length).toBe(1);
  });
});

describe("BT-346-06: tool-loop max iterations exceeded → typed workflow_failed failure", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();

    // Always return tool-calls — never finishes
    openAgentResultSequence = Array.from({ length: 30 }, () => ({
      finishReason: "tool-calls" as const,
      rawFinishReason: "tool_use",
      steps: [{ toolCalls: [{ toolName: "bash" }] }],
      response: { messages: [] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));
  });

  test("BT-346-06: exhausting max iterations → workflow_failed failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("workflow_failed");
    // Error message must mention the bound
    expect(result.errorMessage).toContain("steps");
  });

  test("BT-346-06: sandbox disposed even when max iterations exceeded", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(sandboxStopMock.mock.calls.length).toBe(1);
  });
});

describe("BT-346-07: timeout still enforced (AbortError → workflow_failed)", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false;
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();

    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    openAgentShouldThrow = abortErr;
  });

  test("BT-346-07: AbortError from generate → workflow_failed (timeout enforced)", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("workflow_failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 3: commit failure must fail the step
// ─────────────────────────────────────────────────────────────────────────────

describe("BT-346-08: createCommit returns { ok: false } → step fails with commit_failed", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    createCommitMockResult = { ok: false, error: "SHA mismatch" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-346-08: commit ok:false → outcome is failure", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
  });

  test("BT-346-08: commit ok:false → errorKind is commit_failed", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.errorKind).toBe("commit_failed");
  });

  test("BT-346-08: commit failure reason included in errorMessage", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.errorMessage).toBeDefined();
    expect((result.errorMessage ?? "").length).toBeGreaterThan(0);
  });

  test("BT-346-08: step run DB record updated as failed with commit_failed", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const failedUpdate = recordedStepUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("commit_failed");
  });
});

describe("BT-346-09: createCommit throws → step fails with commit_failed", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    createCommitMockShouldThrow = new Error("Network timeout during commit");
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-346-09: createCommit throws → outcome is failure with commit_failed", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("commit_failed");
  });
});

describe("BT-346-10: commit failure → sandbox still disposed", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    createCommitMockResult = { ok: false, error: "Ref update failed" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-346-10: sandbox.stop() called even when commit fails", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(sandboxStopMock.mock.calls.length).toBe(1);
  });
});

describe("BT-346-11: commit failure → step.commit.failed event (not .completed)", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = true;
    createCommitMockResult = { ok: false, error: "Forbidden" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-346-11: commit failure emits agent-loop.step.commit.failed event", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const commitFailedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.commit.failed",
    );
    expect(commitFailedEvent).toBeDefined();
  });

  test("BT-346-11: commit failure event has error level", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const commitFailedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.commit.failed",
    );
    expect(commitFailedEvent?.level).toBe("error");
  });

  test("BT-346-11: commit.completed event NOT emitted on commit failure", async () => {
    await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    const commitCompletedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.commit.completed",
    );
    expect(commitCompletedEvent).toBeUndefined();
  });
});

describe("BT-346-12: no-changes path unaffected by commit failure handling", () => {
  beforeEach(() => {
    resetMocks();
    hasUncommittedChangesResult = false; // No changes
    // createCommit would fail if called — but it should NOT be called
    createCommitMockResult = { ok: false, error: "Should not be called" };
    currentStepRun = makeStepRun();
    currentLoopRun = makeLoopRun();
    currentLoop = makeLoop();
  });

  test("BT-346-12: no file changes → success (commit failure handling not triggered)", async () => {
    const result = await executeAgentStep({
      stepRunId: "step-p1-1",
      workflowRunId: "wf-p1-1",
      loopRunId: "run-p1-1",
      node: makeAgentStepNode() as Parameters<
        typeof executeAgentStep
      >[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
    expect(createCommitMock.mock.calls.length).toBe(0);
  });
});
