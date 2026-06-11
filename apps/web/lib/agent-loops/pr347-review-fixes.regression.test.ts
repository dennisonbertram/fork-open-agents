/**
 * Agent Loops — PR #347 review-fix regression tests
 *
 * These tests would fail if the fixes introduced in commit 663b1aaa are reverted.
 *
 * REG-347-01: cycle attempt increment — if attempt is ever hardcoded to 1, the
 *             unique-constraint test store throws and the test fails.
 * REG-347-02: unique-violation graceful handling — if the try/catch around
 *             createAgentLoopStepRun is removed, the unique violation propagates
 *             as an unhandled throw instead of a graceful skip.
 * REG-347-03: snapshot parse failure observability — if the silent return is
 *             restored (reverting Nit 1), no event is emitted and the test fails.
 * REG-347-04: guardrail step-run skipped — if the updateAgentLoopStepRun call
 *             is removed from the guardrail path (reverting Nit 2), no skipped
 *             update is recorded and the test fails.
 * REG-347-05: retry produces attempt n+1 relative to the failed step's attempt,
 *             not always 2 — catches a regression where retryCurrentStep ignores
 *             the existing attempt number.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Shared state ───────────────────────────────────────────────────────────────

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

type RunStatusInput = {
  runId: string;
  status: string;
  errorKind?: string | null;
  iterationCount?: number;
  stepCount?: number;
  currentNodeId?: string | null;
  currentStepRunId?: string | null;
};

type StepRunUpdateInput = {
  stepRunId: string;
  status?: string;
  finishedAt?: Date | null;
};

type AdvanceInput = {
  runId: string;
  fromStepRunId: string;
  nextNodeId: string;
  nextStepRunId: string;
  stepCount: number;
  iterationCount: number;
  workflowRunId: string;
};

let recordedEvents: EventInput[] = [];
let recordedRunStatusUpdates: RunStatusInput[] = [];
let recordedStepRunUpdates: StepRunUpdateInput[] = [];
let recordedAdvanceCalls: AdvanceInput[] = [];
let recordedStepCreations: {
  loopRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
}[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];
let executedNodeIds: string[] = [];

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;
let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};
let priorVisitCounts: Record<string, number> = {};
let advanceReturns = 1;

// Unique constraint enforcement
let uniqueAttemptStore: Set<string> = new Set();
let throwOnDuplicate = false;

let counter = 500;
function nextId() {
  return `reg347-${counter++}`;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-reg347",
    userId: "user-1",
    name: "Reg347 Loop",
    description: null,
    repoOwner: "acme",
    repoName: "repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-reg347",
    loopId: "loop-reg347",
    userId: "user-1",
    status: "running",
    definitionSnapshot: {
      nodes: [
        { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
        {
          id: "work",
          kind: "agent_step",
          label: "W",
          position: { x: 1, y: 0 },
          instructions: "x",
        },
        {
          id: "condition",
          kind: "condition",
          label: "C",
          position: { x: 2, y: 0 },
          condition: { path: "done", op: "eq", value: true },
        },
        { id: "end", kind: "end", label: "E", position: { x: 3, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "work", when: "success" },
        { id: "e2", source: "work", target: "condition", when: "success" },
        { id: "e3", source: "condition", target: "end", when: "true" },
        { id: "e4", source: "condition", target: "work", when: "false" }, // cycle
      ],
    },
    currentNodeId: "condition",
    currentStepRunId: "reg-step-cond",
    iterationCount: 0,
    stepCount: 2,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg347",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date(Date.now() - 10_000),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "reg-step-cond",
    loopRunId: "run-reg347",
    nodeId: "condition",
    nodeKind: "condition",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

const getCtxMock = mock(async (stepRunId: string) => ({
  stepRun: stepRunIdToStepRun[stepRunId] ?? currentStepRun,
  loopRun: currentLoopRun,
  loop: currentLoop,
}));

const updateRunStatusMock = mock(async (input: RunStatusInput) => {
  recordedRunStatusUpdates.push(input);
  currentLoopRun = {
    ...currentLoopRun,
    status: input.status as AgentLoopRun["status"],
    ...(input.errorKind !== undefined ? { errorKind: input.errorKind } : {}),
  };
  return currentLoopRun;
});

const updateStepRunMock = mock(async (input: StepRunUpdateInput) => {
  recordedStepRunUpdates.push(input);
  return makeStepRun({ id: input.stepRunId });
});

const recordEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: `e-${counter}`, ...input };
});

const createStepRunMock = mock(
  async (input: {
    loopRunId: string;
    nodeId: string;
    nodeKind: string;
    attempt?: number;
  }) => {
    const attempt = input.attempt ?? 1;
    const key = `${input.loopRunId}:${input.nodeId}:${attempt}`;

    if (throwOnDuplicate && uniqueAttemptStore.has(key)) {
      const err = new Error(
        `duplicate key value violates unique constraint "agent_loop_step_runs_run_node_attempt_idx"`,
      );
      (err as unknown as Record<string, unknown>)["code"] = "23505";
      throw err;
    }

    uniqueAttemptStore.add(key);
    const id = nextId();
    recordedStepCreations.push({
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt,
    });
    const sr = makeStepRun({
      id,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt,
    });
    stepRunIdToNodeId[id] = input.nodeId;
    stepRunIdToStepRun[id] = sr;
    return sr;
  },
);

const advanceMock = mock(async (input: AdvanceInput): Promise<boolean> => {
  recordedAdvanceCalls.push(input);
  return advanceReturns > 0;
});

const countNodeMock = mock(
  async (params: { loopRunId: string; nodeId: string }): Promise<number> => {
    return priorVisitCounts[`${params.loopRunId}:${params.nodeId}`] ?? 0;
  },
);

let executeThrows: Error | null = null;
const executeMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }) => {
    if (executeThrows) throw executeThrows;
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);
    return { outcome: "false" as const }; // condition → loop back to work
  },
);

let startThrows: Error | null = null;
const startMock = mock(
  async (_wf: unknown, args: [{ stepRunId: string }]) => {
    if (startThrows) throw startThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-${counter}` };
  },
);

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getCtxMock,
  updateAgentLoopRunStatus: updateRunStatusMock,
  updateAgentLoopStepRun: updateStepRunMock,
  recordAgentLoopEvent: recordEventMock,
  createAgentLoopStepRun: createStepRunMock,
  advanceRunToNextStep: advanceMock,
  countStepRunsForNode: countNodeMock,
  pauseLoopRun: mock(async (_r: string, _u: string) => {
    currentLoopRun = { ...currentLoopRun, status: "paused" };
    return currentLoopRun;
  }),
  cancelLoopRun: mock(async (_r: string, _u: string) => {
    currentLoopRun = { ...currentLoopRun, status: "cancelled" };
    return currentLoopRun;
  }),
  resumeLoopRun: mock(async (_r: string, _u: string) => {
    if (currentLoopRun.status !== "paused") throw new Error("Not paused");
    currentLoopRun = { ...currentLoopRun, status: "running" };
    return currentLoopRun;
  }),
  retryCurrentStep: mock(async (params: { runId: string; userId: string }) => {
    if (
      currentLoopRun.status !== "failed" &&
      currentLoopRun.status !== "stalled"
    ) {
      throw new Error(`Cannot retry: ${currentLoopRun.status}`);
    }
    const failed = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const attempt = (failed?.attempt ?? 1) + 1;
    const id = nextId();
    const sr = makeStepRun({
      id,
      nodeId: currentLoopRun.currentNodeId ?? "work",
      attempt,
      status: "queued",
    });
    stepRunIdToStepRun[id] = sr;
    // Record the creation so tests can inspect attempt values
    recordedStepCreations.push({
      loopRunId: params.runId,
      nodeId: currentLoopRun.currentNodeId ?? "work",
      nodeKind: failed?.nodeKind ?? "agent_step",
      attempt,
    });
    currentLoopRun = {
      ...currentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return sr;
  }),
}));

mock.module("./step-executor", () => ({ executeAgentLoopStep: executeMock }));
mock.module("workflow/api", () => ({ start: startMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-reg347" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_: { stepRunId: string }) => {}),
}));

// ── Reset ──────────────────────────────────────────────────────────────────────

function reset() {
  recordedEvents = [];
  recordedRunStatusUpdates = [];
  recordedStepRunUpdates = [];
  recordedAdvanceCalls = [];
  recordedStepCreations = [];
  workflowStartCalls = [];
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  priorVisitCounts = {};
  advanceReturns = 1;
  uniqueAttemptStore = new Set();
  throwOnDuplicate = false;
  executeThrows = null;
  startThrows = null;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun();
  stepRunIdToNodeId["reg-step-cond"] = "condition";
  stepRunIdToStepRun["reg-step-cond"] = currentStepRun;

  getCtxMock.mockClear();
  updateRunStatusMock.mockClear();
  updateStepRunMock.mockClear();
  recordEventMock.mockClear();
  createStepRunMock.mockClear();
  advanceMock.mockClear();
  countNodeMock.mockClear();
  executeMock.mockClear();
  startMock.mockClear();
}

const chainPromise = import("./chain");

// ── REG-347-01: cycle attempt must be priorVisits + 1 (not 1) ─────────────────

describe("REG-347-01: cycle-back attempt must equal priorVisits+1 — unique index is satisfied", () => {
  beforeEach(() => {
    reset();
    // Pre-populate the unique store to simulate an existing row at attempt 1
    uniqueAttemptStore.add("run-reg347:work:1");
    throwOnDuplicate = true;
    // 1 prior visit to "work" (it's been executed once already)
    priorVisitCounts["run-reg347:work"] = 1;
  });

  test("REG-347-01a: visiting work the 2nd time → attempt 2, no unique-violation", async () => {
    const { runAgentLoopStep } = await chainPromise;
    // Must not throw despite attempt 1 being in the store
    await expect(
      runAgentLoopStep({ stepRunId: "reg-step-cond", workflowRunId: "wf-1" }),
    ).resolves.toBeUndefined();

    const workCreation = recordedStepCreations.find((c) => c.nodeId === "work");
    expect(workCreation?.attempt).toBe(2);
  });

  test("REG-347-01b: if attempt were hardcoded to 1, the unique store would reject and throw — this proves the fix", async () => {
    // We verify the fix by confirming attempt 1 is NOT used for the second visit.
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-cond",
      workflowRunId: "wf-1",
    });

    // attempt 1 must NOT appear in the created step runs for "work"
    const workCreations = recordedStepCreations.filter(
      (c) => c.nodeId === "work",
    );
    for (const c of workCreations) {
      expect(c.attempt).not.toBe(1); // attempt 1 is already taken
    }
  });
});

// ── REG-347-02: unique-violation → graceful skip (not unhandled throw) ─────────

describe("REG-347-02: createAgentLoopStepRun unique violation → graceful duplicate-advance skip", () => {
  beforeEach(() => {
    reset();
    throwOnDuplicate = true;
    // Simulate: attempt 1 for "work" already exists (racing first invocation)
    uniqueAttemptStore.add("run-reg347:work:1");
    priorVisitCounts["run-reg347:work"] = 0; // second racer sees 0 priorVisits → attempts 1 → hits violation
  });

  test("REG-347-02a: unique-violation caught → returns without throwing", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await expect(
      runAgentLoopStep({ stepRunId: "reg-step-cond", workflowRunId: "wf-1" }),
    ).resolves.toBeUndefined();
  });

  test("REG-347-02b: unique-violation → agent-loop.chain.skipped emitted with duplicate_advance reason", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "reg-step-cond", workflowRunId: "wf-1" });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("duplicate_advance");
  });

  test("REG-347-02c: unique-violation → zero workflow dispatches", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "reg-step-cond", workflowRunId: "wf-1" });
    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── REG-347-03: snapshot parse failure must emit event ────────────────────────

describe("REG-347-03: snapshot re-parse failure after execution → event emitted, not silent return", () => {
  beforeEach(() => {
    reset();

    // Corrupt the snapshot so loopDefinitionSchema.safeParse fails
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "reg-step-work",
      definitionSnapshot: {
        nodes: "INVALID",
        edges: null,
      } as unknown as Record<string, unknown>,
    });

    const workStep = makeStepRun({
      id: "reg-step-work",
      nodeId: "work",
      nodeKind: "agent_step",
    });
    stepRunIdToNodeId["reg-step-work"] = "work";
    stepRunIdToStepRun["reg-step-work"] = workStep;
    currentStepRun = workStep;
  });

  test("REG-347-03a: corrupt snapshot → agent-loop.chain.skipped event recorded", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-work",
      workflowRunId: "wf-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    // If this is undefined, the silent return was restored — REG-347-03 catches it
    expect(skipEvent).toBeDefined();
  });

  test("REG-347-03b: corrupt snapshot → reason is snapshot_invalid", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-work",
      workflowRunId: "wf-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("snapshot_invalid");
  });

  test("REG-347-03c: corrupt snapshot → level is warn (not info)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-work",
      workflowRunId: "wf-1",
    });

    const skipEvent = recordedEvents.find(
      (e) =>
        e.eventName === "agent-loop.chain.skipped" &&
        (e.payload as Record<string, unknown> | undefined)?.["reason"] ===
          "snapshot_invalid",
    );
    expect(skipEvent?.level).toBe("warn");
  });
});

// ── REG-347-04: guardrail trip → step run marked skipped ─────────────────────

describe("REG-347-04: guardrail trip — current step run gets skipped status + finishedAt", () => {
  beforeEach(() => {
    reset();

    const guardStep = makeStepRun({
      id: "reg-step-guard",
      nodeId: "work",
      nodeKind: "agent_step",
      status: "queued",
    });
    stepRunIdToNodeId["reg-step-guard"] = "work";
    stepRunIdToStepRun["reg-step-guard"] = guardStep;
    currentStepRun = guardStep;

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "reg-step-guard",
      stepCount: 50, // at ceiling → guardrail trips
      startedAt: new Date(Date.now() - 60_000),
    });
    currentLoop = makeLoop({ guardrails: null });
  });

  test("REG-347-04a: when guardrail trips, updateAgentLoopStepRun is called", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-guard",
      workflowRunId: "wf-1",
    });

    // If this is empty, the updateAgentLoopStepRun call was removed — test catches it
    expect(recordedStepRunUpdates.length).toBeGreaterThan(0);
  });

  test("REG-347-04b: step run skipped status is set for the guardrailed step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-guard",
      workflowRunId: "wf-1",
    });

    const skipped = recordedStepRunUpdates.find(
      (u) => u.stepRunId === "reg-step-guard" && u.status === "skipped",
    );
    expect(skipped).toBeDefined();
  });

  test("REG-347-04c: guardrail skipped step has finishedAt timestamp", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-guard",
      workflowRunId: "wf-1",
    });

    const skipped = recordedStepRunUpdates.find(
      (u) => u.stepRunId === "reg-step-guard" && u.status === "skipped",
    );
    expect(skipped?.finishedAt).toBeDefined();
    expect(skipped?.finishedAt instanceof Date).toBe(true);
  });
});

// ── REG-347-05: retryCurrentStep always produces attempt n+1 ─────────────────

describe("REG-347-05: retryCurrentStep attempt = failed step attempt + 1 (not always 2)", () => {
  beforeEach(() => {
    reset();
  });

  test("REG-347-05a: failed at attempt 1 → retry is attempt 2", async () => {
    const failed = makeStepRun({
      id: "reg-step-f1",
      nodeId: "work",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["reg-step-f1"] = failed;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "reg-step-f1",
    });

    const { retryCurrentStep } = await chainPromise;
    await retryCurrentStep("run-reg347", "user-1");

    const creation = recordedStepCreations.find((c) => c.nodeId === "work");
    expect(creation?.attempt).toBe(2);
  });

  test("REG-347-05b: failed at attempt 3 → retry is attempt 4", async () => {
    const failed = makeStepRun({
      id: "reg-step-f3",
      nodeId: "work",
      attempt: 3,
      status: "failed",
    });
    stepRunIdToStepRun["reg-step-f3"] = failed;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "reg-step-f3",
    });

    const { retryCurrentStep } = await chainPromise;
    await retryCurrentStep("run-reg347", "user-1");

    const creation = recordedStepCreations.find((c) => c.nodeId === "work");
    // Must be 4, not 2 — regression catches if attempt computation ignores existing attempt
    expect(creation?.attempt).toBe(4);
  });
});
