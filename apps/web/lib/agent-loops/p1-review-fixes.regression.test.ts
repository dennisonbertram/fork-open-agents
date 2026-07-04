/**
 * Agent Loops — P1 review-fix regression tests (TASK-346-P1)
 *
 * These tests lock in the behaviors fixed in 44ab4b89. Each would fail
 * if the corresponding fix were reverted.
 *
 * REG-346-01: resolveWorkingBranch — own-node branch priority
 *   Reverting to lookupContextPath("${nodeId}.branch") keeps this behavior,
 *   but any regression in resolveWorkingBranch would break it.
 *
 * REG-346-02: resolveWorkingBranch — prior-step branch scan
 *   Without the insertion-order scan, a downstream step would always clone
 *   the default branch instead of the branch written by the producing step.
 *
 * REG-346-03: resolveWorkingBranch pure-function edge cases
 *   Non-object, null, and empty-branch entries must all be skipped cleanly.
 *
 * REG-346-04: tool-loop must continue past tool-calls finishReason
 *   Reverting to a single generate() call → output not written to
 *   /tmp/loop-step-output.json → step_output_invalid, not success.
 *
 * REG-346-05: max-loop-steps exhausted → workflow_failed (not silent hang)
 *
 * REG-346-06: commit_failed on ok:false commit — NOT a silent success
 *   The original bug: the code fell through and the step was marked succeeded
 *   while the sandbox (and all changes) was destroyed.
 *
 * REG-346-07: commit_failed on throwing commit — same protection
 *
 * REG-346-08: no-changes path never hits commit failure path
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── REG-346-01/02/03: resolveWorkingBranch pure-function tests ────────────────
// Import the helper directly — no mocking needed, it's a pure function.

const { resolveWorkingBranch } = await import("./resolve-working-branch");

describe("REG-346-01: resolveWorkingBranch — own-node branch wins", () => {
  test("own-node entry with branch string wins over any prior-step entry", () => {
    const context = {
      "prior-step": { branch: "feat/prior", result: "x" },
      "my-node": { branch: "feat/own-node", result: "y" },
    };
    expect(resolveWorkingBranch(context, "my-node", "main")).toBe(
      "feat/own-node",
    );
  });

  test("own-node wins even when it is NOT the last insertion-order entry", () => {
    // own-node first, then a later step with a different branch
    const context = {
      "my-node": { branch: "feat/own-node", result: "y" },
      "later-step": { branch: "feat/later", result: "z" },
    };
    // own-node should win — not "later-step"
    expect(resolveWorkingBranch(context, "my-node", "main")).toBe(
      "feat/own-node",
    );
  });
});

describe("REG-346-02: resolveWorkingBranch — prior-step insertion-order scan", () => {
  test("last context entry with a non-empty branch string wins when no own-node entry", () => {
    const context = {
      "step-a": { branch: "feat/step-a", result: "a" },
      "step-b": { branch: "feat/step-b", result: "b" },
    };
    // step-b was inserted after step-a — it must win
    expect(resolveWorkingBranch(context, "step-c", "main")).toBe("feat/step-b");
  });

  test("only entries are step-a and step-b with step-a coming first — step-b wins", () => {
    // Explicit test that insertion order drives the result.
    // Object literal property order matches insertion order in JavaScript.
    const context: Record<string, unknown> = {
      alpha: { branch: "feat/alpha" },
      zeta: { branch: "feat/zeta" },
    };
    // zeta was declared after alpha, so it should win
    expect(resolveWorkingBranch(context, "other-node", "main")).toBe(
      "feat/zeta",
    );
  });
});

describe("REG-346-03: resolveWorkingBranch — invalid entries skipped", () => {
  test("string context values are skipped", () => {
    const context = {
      "step-string": "feat/branch-string",
      "step-valid": { branch: "feat/valid" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("number context values are skipped", () => {
    const context = {
      "step-number": 42,
      "step-valid": { branch: "feat/valid" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("null context values are skipped", () => {
    const context: Record<string, unknown> = {
      "step-null": null,
      "step-valid": { branch: "feat/valid" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("array context values are skipped", () => {
    const context: Record<string, unknown> = {
      "step-array": ["feat/branch"],
      "step-valid": { branch: "feat/valid" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("object entries with empty branch string are skipped", () => {
    const context = {
      "step-empty": { branch: "", result: "x" },
      "step-valid": { branch: "feat/valid", result: "y" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("object entries with non-string branch are skipped", () => {
    const context: Record<string, unknown> = {
      "step-num-branch": { branch: 42, result: "x" },
      "step-valid": { branch: "feat/valid", result: "y" },
    };
    expect(resolveWorkingBranch(context, "node", "main")).toBe("feat/valid");
  });

  test("fallback to defaultBranch when all entries are invalid", () => {
    const context: Record<string, unknown> = {
      "step-string": "not-an-object",
      "step-empty": { branch: "" },
      "step-null": null,
    };
    expect(resolveWorkingBranch(context, "node", "develop")).toBe("develop");
  });

  test("fallback to defaultBranch on empty context", () => {
    expect(resolveWorkingBranch({}, "any-node", "main")).toBe("main");
  });
});

// ── REG-346-04/05: executeAgentStep tool-loop regressions ─────────────────────

type EventInput = {
  loopRunId: string;
  eventName: string;
  status: string;
  level?: string;
  [key: string]: unknown;
};
type StepUpdateInput = {
  stepRunId: string;
  status?: string;
  errorKind?: string | null;
  [key: string]: unknown;
};

let regEvents: EventInput[] = [];
let regStepUpdates: StepUpdateInput[] = [];
let currentStepRun: AgentLoopStepRun;
let currentLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;

const regUpdateStepRunMock = mock(async (input: StepUpdateInput) => {
  regStepUpdates.push(input);
  return { ...currentStepRun, ...(input as Partial<AgentLoopStepRun>) };
});

const regRecordEventMock = mock(async (input: EventInput) => {
  regEvents.push(input);
  return { id: "reg-346-evt", ...input };
});

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: mock(async (_id: string) => ({
    stepRun: currentStepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  })),
  updateAgentLoopStepRun: regUpdateStepRunMock,
  recordAgentLoopEvent: regRecordEventMock,
  updateAgentLoopRunStatus: mock(async () => ({})),
  updateAgentLoopRunContext: mock(async () => ({})),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: mock(async () => ({
    ok: true,
    installationId: 1,
    repositoryId: 2,
    defaultBranch: "main",
  })),
}));

let regCreateCommitResult: { ok: boolean; commitSha?: string; error?: string } =
  { ok: true, commitSha: "regsha" };
let regCreateCommitShouldThrow: Error | null = null;

const regCreateCommitMock = mock(async () => {
  if (regCreateCommitShouldThrow) throw regCreateCommitShouldThrow;
  return regCreateCommitResult;
});

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mock(async () => ({ token: "ghs_reg_346" })),
  revokeInstallationToken: mock(async () => undefined),
  withScopedInstallationOctokit: mock(
    async (params: { operation: (octokit: unknown) => Promise<unknown> }) =>
      params.operation({ rest: {} }),
  ),
}));

const regSandboxStopMock = mock(async () => undefined);
let regSandboxReadFileResult: string | Error = JSON.stringify({
  result: "done",
});
let regHasUncommittedChanges = false;

const regSandboxMock = {
  type: "cloud" as const,
  workingDirectory: "/repo",
  currentBranch: "main",
  environmentDetails: "test",
  host: "test.sandbox",
  getState: () => ({
    type: "vercel",
    sandboxName: "agent_loop_reg-step",
    source: { repo: "https://github.com/acme/repo.git", branch: "main" },
  }),
  readFile: mock(async (_p: string, _e: "utf-8") => {
    if (regSandboxReadFileResult instanceof Error)
      throw regSandboxReadFileResult;
    return regSandboxReadFileResult;
  }),
  exec: mock(async () => ({
    success: true,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    truncated: false,
  })),
  stop: regSandboxStopMock,
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

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: mock(async () => regSandboxMock),
  hasUncommittedChanges: mock(async () => regHasUncommittedChanges),
  stageAll: mock(async () => undefined),
  getCurrentBranch: mock(async () => "main"),
  getHeadSha: mock(async () => "regheadsha"),
  getStagedDiff: mock(async () => "diff"),
  getChangedFiles: mock(async () =>
    regHasUncommittedChanges
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

// openAgent with sequence control
let regOpenAgentSequence: Array<{
  finishReason: string;
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
let regOpenAgentCallCount = 0;
let regOpenAgentShouldThrow: Error | null = null;

const regOpenAgentMock = mock(async () => {
  if (regOpenAgentShouldThrow) throw regOpenAgentShouldThrow;
  regOpenAgentCallCount++;
  if (regOpenAgentSequence.length > 0) {
    return regOpenAgentSequence.shift()!;
  }
  return {
    finishReason: "stop",
    rawFinishReason: "end_turn",
    steps: [{ toolCalls: [] }],
    response: { messages: [] },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
});

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  openAgent: { generate: regOpenAgentMock },
  gateway: mock((m: string) => m),
}));

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox: mock(async () => ({
    ok: true,
    intent: {
      owner: "acme",
      repo: "repo",
      repositoryId: 2,
      installationId: 1,
      branch: "main",
      expectedHeadSha: "regheadsha",
      message: "chore: changes",
      files: [{ path: "f.ts" }],
    },
  })),
}));

mock.module("@/lib/github/commit", () => ({
  createCommit: regCreateCommitMock,
  buildCoAuthor: mock(async () => null),
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: undefined,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// Fixtures
function makeRegStepRun(o: Partial<AgentLoopStepRun> = {}): AgentLoopStepRun {
  return {
    id: "reg-step-1",
    loopRunId: "reg-run-1",
    nodeId: "reg-node-1",
    nodeKind: "agent_step",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "reg-wf-1",
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...o,
  };
}

function makeRegLoopRun(o: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "reg-run-1",
    loopId: "reg-loop-1",
    userId: "reg-user-1",
    status: "running",
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "reg-idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "reg-wf-1",
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

function makeRegLoop(o: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "reg-loop-1",
    userId: "reg-user-1",
    name: "Reg Loop",
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
    ...o,
  };
}

function makeRegNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-node-1",
    kind: "agent_step",
    label: "Reg Work",
    position: { x: 0, y: 0 },
    instructions: "Do work.",
    ...overrides,
  };
}

function resetRegMocks() {
  regEvents = [];
  regStepUpdates = [];
  regHasUncommittedChanges = false;
  regOpenAgentSequence = [];
  regOpenAgentCallCount = 0;
  regOpenAgentShouldThrow = null;
  regCreateCommitResult = { ok: true, commitSha: "regsha" };
  regCreateCommitShouldThrow = null;
  regSandboxReadFileResult = JSON.stringify({ result: "done" });

  regUpdateStepRunMock.mockClear();
  regRecordEventMock.mockClear();
  regSandboxStopMock.mockClear();
  regSandboxMock.readFile.mockClear();
  regOpenAgentMock.mockClear();
  regCreateCommitMock.mockClear();

  currentStepRun = makeRegStepRun();
  currentLoopRun = makeRegLoopRun();
  currentLoop = makeRegLoop();
}

// Import after mocks
const { executeAgentStep } = await import("./agent-step");

describe("REG-346-04: tool-loop runs to completion — multi-turn agent", () => {
  beforeEach(() => resetRegMocks());

  test("two tool-calls iterations then stop → success (not step_output_invalid)", async () => {
    regOpenAgentSequence = [
      {
        finishReason: "tool-calls",
        steps: [{ toolCalls: [{ toolName: "bash" }] }],
        response: { messages: [] },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        totalUsage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
      {
        finishReason: "tool-calls",
        steps: [{ toolCalls: [{ toolName: "read_file" }] }],
        response: { messages: [] },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        totalUsage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
      // next default call returns "stop"
    ];

    const result = await executeAgentStep({
      stepRunId: "reg-step-1",
      workflowRunId: "reg-wf-1",
      loopRunId: "reg-run-1",
      node: makeRegNode() as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // The regression: if only one generate() call, finishReason=tool-calls
    // means the output file was never written → step_output_invalid.
    // With the loop, the 3rd call returns stop, output is read, step succeeds.
    expect(result.outcome).toBe("success");
    expect(regOpenAgentCallCount).toBe(3);
  });
});

describe("REG-346-05: max-iterations bound prevents infinite loop", () => {
  beforeEach(() => resetRegMocks());

  test("forever tool-calls → workflow_failed (bounded, not infinite)", async () => {
    // All 30 entries return tool-calls (sequence cycles via shift, exhausts to default)
    regOpenAgentSequence = Array.from({ length: 30 }, () => ({
      finishReason: "tool-calls" as const,
      steps: [{ toolCalls: [{}] }],
      response: { messages: [] },
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      totalUsage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    }));

    const result = await executeAgentStep({
      stepRunId: "reg-step-1",
      workflowRunId: "reg-wf-1",
      loopRunId: "reg-run-1",
      node: makeRegNode() as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // The regression: without the bound this would call generate() forever
    expect(result.outcome).toBe("failure");
    // #862: turn exhaustion now records its own errorKind, not workflow_failed.
    expect(result.errorKind).toBe("turn_budget_exceeded");
    // generate() was called at most the default maxAgentTurnsPerStep (8) times
    expect(regOpenAgentCallCount).toBeLessThanOrEqual(8);
    // Sandbox must be disposed
    expect(regSandboxStopMock.mock.calls.length).toBe(1);
  });
});

describe("REG-346-06: commit ok:false → commit_failed, NOT silent success", () => {
  beforeEach(() => {
    resetRegMocks();
    regHasUncommittedChanges = true;
    regCreateCommitResult = { ok: false, error: "SHA conflict" };
  });

  test("createCommit ok:false → step failed as commit_failed (not succeeded)", async () => {
    const result = await executeAgentStep({
      stepRunId: "reg-step-1",
      workflowRunId: "reg-wf-1",
      loopRunId: "reg-run-1",
      node: makeRegNode() as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    // REGRESSION: the original code let ok:false fall through to "succeeded"
    // while the sandbox (containing all the agent's changes) was destroyed.
    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("commit_failed");
    // Sandbox must still be disposed (in finally)
    expect(regSandboxStopMock.mock.calls.length).toBe(1);
    // commit.failed event must be emitted
    const failEvent = regEvents.find(
      (e) => e.eventName === "agent-loop.step.commit.failed",
    );
    expect(failEvent).toBeDefined();
    expect(failEvent?.level).toBe("error");
  });
});

describe("REG-346-07: createCommit throws → commit_failed (work not silently lost)", () => {
  beforeEach(() => {
    resetRegMocks();
    regHasUncommittedChanges = true;
    regCreateCommitShouldThrow = new Error("GitHub API 500");
  });

  test("createCommit throws → commit_failed failure, not exception propagation", async () => {
    const result = await executeAgentStep({
      stepRunId: "reg-step-1",
      workflowRunId: "reg-wf-1",
      loopRunId: "reg-run-1",
      node: makeRegNode() as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("commit_failed");
    expect(regSandboxStopMock.mock.calls.length).toBe(1);
  });
});

describe("REG-346-08: no-changes path never triggers commit failure path", () => {
  beforeEach(() => {
    resetRegMocks();
    regHasUncommittedChanges = false;
    // Poison the commit mock — if called, it would fail
    regCreateCommitResult = { ok: false, error: "Should not be called" };
  });

  test("no changes → success, commit helpers not invoked", async () => {
    const result = await executeAgentStep({
      stepRunId: "reg-step-1",
      workflowRunId: "reg-wf-1",
      loopRunId: "reg-run-1",
      node: makeRegNode() as Parameters<typeof executeAgentStep>[0]["node"],
      loopRun: currentLoopRun,
      loop: currentLoop,
      startedAt: Date.now(),
    });

    expect(result.outcome).toBe("success");
    expect(regCreateCommitMock.mock.calls.length).toBe(0);
  });
});
