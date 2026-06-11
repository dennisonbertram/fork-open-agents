/**
 * Agent Loops — chain.ts regression tests (M1-06)
 *
 * These tests would fail if the implementation in chain.ts is reverted or
 * if any safety property is dropped.
 *
 * REG-C01: Guardrail ceiling enforcement — resolveGuardrails cannot be bypassed
 *          by user-supplied values above the ceiling.
 * REG-C02: Double-dispatch pin — the conditional advance is the ONLY mechanism
 *          preventing double-dispatch; this test pins the exact behavior.
 * REG-C03: Cooperative pre-check pin — a cancelled run NEVER executes the step,
 *          regardless of the step's node kind.
 * REG-C04: End-node no-dispatch — removing the end-node guard would cause an
 *          extra dispatch to a phantom "next step" that doesn't exist.
 * REG-C05: resolveGuardrails default fallback — if GUARDRAIL_DEFAULTS are
 *          removed, this test catches it by verifying the exact expected defaults.
 * REG-C06: run.started exactly once — if the queued→running check is removed,
 *          run.started fires on every step invocation, not just the first.
 * REG-C07: chain_route_missing uses a distinct event name (not a generic failure),
 *          so the stall sweep and observability can distinguish dangling edges.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Captured calls (same pattern as chain.test.ts) ───────────────────────────

type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  payload?: unknown;
  workflowRunId?: string | null;
};

type RunStatusInput = {
  runId: string;
  status: string;
  errorKind?: string | null;
  errorMessage?: string | null;
  stepCount?: number;
  iterationCount?: number;
};

type AdvanceRunInput = {
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
let recordedAdvanceCalls: AdvanceRunInput[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];
let executedNodeIds: string[] = [];

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;
let advanceRunRowsUpdated = 1;
let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};
let executorOutcomes: Record<
  string,
  { outcome: "success" | "failure" | "true" | "false"; errorKind?: string }
> = {};
let endNodeIds = new Set<string>(["end"]);
let workflowStartThrows: Error | null = null;
let stepRunCounter = 300;

function nextId() {
  return `reg-step-${stepRunCounter++}`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-1",
    loopId: "loop-1",
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
        { id: "end", kind: "end", label: "E", position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "work", when: "success" },
        { id: "e2", source: "work", target: "end", when: "success" },
      ],
    },
    currentNodeId: "work",
    currentStepRunId: "step-1",
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date(Date.now() - 60_000),
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
    id: "step-1",
    loopRunId: "run-1",
    nodeId: "work",
    nodeKind: "agent_step",
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

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

const recordEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: "evt-r", ...input };
});

const createStepRunMock = mock(
  async (input: {
    loopRunId: string;
    nodeId: string;
    nodeKind: string;
    attempt?: number;
  }) => {
    const id = nextId();
    const sr = makeStepRun({
      id,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt: input.attempt ?? 1,
    });
    stepRunIdToNodeId[id] = input.nodeId;
    stepRunIdToStepRun[id] = sr;
    return sr;
  },
);

const advanceMock = mock(async (input: AdvanceRunInput): Promise<boolean> => {
  recordedAdvanceCalls.push(input);
  return advanceRunRowsUpdated > 0;
});

const countStepRunsMock = mock(
  async (_params: { loopRunId: string; nodeId: string }) => 0,
);

const executeStepMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }) => {
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

    if (endNodeIds.has(nodeId)) {
      currentLoopRun = { ...currentLoopRun, status: "completed" };
    }

    return executorOutcomes[nodeId] ?? { outcome: "success" as const };
  },
);

const workflowStartMock = mock(
  async (_wf: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-${stepRunCounter}` };
  },
);

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getCtxMock,
  updateAgentLoopRunStatus: updateRunStatusMock,
  updateAgentLoopStepRun: mock(async (_input: unknown) => currentStepRun),
  recordAgentLoopEvent: recordEventMock,
  createAgentLoopStepRun: createStepRunMock,
  advanceRunToNextStep: advanceMock,
  countStepRunsForNode: countStepRunsMock,
  pauseLoopRun: mock(async (_runId: string, _: string) => {
    if (
      currentLoopRun.status !== "running" &&
      currentLoopRun.status !== "queued"
    ) {
      throw new Error(`Cannot pause: ${currentLoopRun.status}`);
    }
    currentLoopRun = { ...currentLoopRun, status: "paused" };
    return currentLoopRun;
  }),
  cancelLoopRun: mock(async (_runId: string, _: string) => {
    const ok = new Set(["running", "queued", "paused"]);
    if (!ok.has(currentLoopRun.status))
      throw new Error(`Cannot cancel: ${currentLoopRun.status}`);
    currentLoopRun = { ...currentLoopRun, status: "cancelled" };
    return currentLoopRun;
  }),
  resumeLoopRun: mock(async (_runId: string, _: string) => {
    if (currentLoopRun.status !== "paused") throw new Error("Not paused");
    currentLoopRun = { ...currentLoopRun, status: "running" };
    return currentLoopRun;
  }),
  retryCurrentStep: mock(async (_params: { runId: string; userId: string }) => {
    if (
      currentLoopRun.status !== "failed" &&
      currentLoopRun.status !== "stalled"
    ) {
      throw new Error(`Cannot retry: ${currentLoopRun.status}`);
    }
    const id = nextId();
    const sr = makeStepRun({ id, attempt: 2, status: "queued" });
    stepRunIdToStepRun[id] = sr;
    currentLoopRun = {
      ...currentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return sr;
  }),
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeStepMock,
}));

mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-reg" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_: { stepRunId: string }) => {}),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

function reset() {
  recordedEvents = [];
  recordedRunStatusUpdates = [];
  recordedAdvanceCalls = [];
  workflowStartCalls = [];
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  executorOutcomes = {};
  endNodeIds = new Set(["end"]);
  advanceRunRowsUpdated = 1;
  workflowStartThrows = null;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-1", nodeId: "work" });
  stepRunIdToNodeId["step-1"] = "work";
  stepRunIdToStepRun["step-1"] = currentStepRun;

  getCtxMock.mockClear();
  updateRunStatusMock.mockClear();
  recordEventMock.mockClear();
  createStepRunMock.mockClear();
  advanceMock.mockClear();
  countStepRunsMock.mockClear();
  executeStepMock.mockClear();
  workflowStartMock.mockClear();
}

const chainPromise = import("./chain");

// ── REG-C01: Guardrail ceiling enforcement ────────────────────────────────────

describe("REG-C01: resolveGuardrails ceiling clamp cannot be bypassed", () => {
  test("REG-C01a: maxStepsPerRun clamped to 200 regardless of user input", async () => {
    const { resolveGuardrails } = await chainPromise;
    // If ceiling clamping is removed, this returns 99999
    expect(resolveGuardrails({ maxStepsPerRun: 99999 }).maxStepsPerRun).toBe(
      200,
    );
  });

  test("REG-C01b: maxIterations clamped to 50 regardless of user input", async () => {
    const { resolveGuardrails } = await chainPromise;
    expect(resolveGuardrails({ maxIterations: 99999 }).maxIterations).toBe(50);
  });

  test("REG-C01c: zero user guardrails → defaults applied", async () => {
    const { resolveGuardrails } = await chainPromise;
    const r = resolveGuardrails(null);
    expect(r.maxStepsPerRun).toBe(50); // GUARDRAIL_DEFAULTS.maxStepsPerRun
    expect(r.maxIterations).toBe(10); // GUARDRAIL_DEFAULTS.maxIterations
    expect(r.maxRunDurationMs).toBe(2 * 60 * 60 * 1000); // 2h
  });

  test("REG-C01d: run trips guardrail when stepCount == maxStepsPerRun (boundary)", async () => {
    reset();
    currentStepRun = makeStepRun({ id: "step-1", nodeId: "work" });
    currentLoopRun = makeLoopRun({
      status: "running",
      stepCount: 50, // Exactly at the default ceiling of 50
      startedAt: new Date(Date.now() - 60_000),
    });
    currentLoop = makeLoop({ guardrails: null });

    executorOutcomes["work"] = { outcome: "success" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // Guardrail must trip — executor NOT called
    expect(executedNodeIds.length).toBe(0);
    const tripped = recordedEvents.find(
      (e) => e.eventName === "agent-loop.guardrail.tripped",
    );
    expect(tripped).toBeDefined();
    const failed = recordedRunStatusUpdates.find(
      (u) => u.status === "failed" && u.errorKind === "guardrail_exceeded",
    );
    expect(failed).toBeDefined();
  });
});

// ── REG-C02: Double-dispatch pin ──────────────────────────────────────────────

describe("REG-C02: advanceRunToNextStep false → zero dispatches (anti-double-dispatch)", () => {
  beforeEach(() => {
    reset();
    executorOutcomes["work"] = { outcome: "success" };
    advanceRunRowsUpdated = 0; // Simulate concurrent advance already happened
  });

  test("REG-C02: when advance returns false, start() is NEVER called", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // start() must never be called — even though execution succeeded
    expect(workflowStartMock.mock.calls.length).toBe(0);
  });

  test("REG-C02: duplicate_advance reason is present in the skipped event payload", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("duplicate_advance");
  });
});

// ── REG-C03: Cooperative pre-check — cancelled run ────────────────────────────

describe("REG-C03: cooperative pre-check prevents execution on non-running runs", () => {
  test("REG-C03: cancelled run — step executor NOT called regardless of node kind", async () => {
    reset();
    currentLoopRun = makeLoopRun({ status: "cancelled" });
    executorOutcomes["work"] = { outcome: "success" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // Under no circumstances should the executor be called on a cancelled run
    expect(executedNodeIds.length).toBe(0);
    expect(workflowStartMock.mock.calls.length).toBe(0);
  });

  test("REG-C03: failed run — also skipped by cooperative check", async () => {
    reset();
    currentLoopRun = makeLoopRun({ status: "failed" });
    executorOutcomes["work"] = { outcome: "success" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    expect(executedNodeIds.length).toBe(0);
  });
});

// ── REG-C04: End-node no-dispatch ─────────────────────────────────────────────

describe("REG-C04: end node — absolutely no dispatch after run is completed", () => {
  beforeEach(() => {
    reset();

    const endStepRun = makeStepRun({
      id: "step-end",
      nodeId: "end",
      nodeKind: "end",
    });
    stepRunIdToNodeId["step-end"] = "end";
    stepRunIdToStepRun["step-end"] = endStepRun;
    currentStepRun = endStepRun;

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "end",
      currentStepRunId: "step-end",
    });

    executorOutcomes["end"] = { outcome: "success" };
    endNodeIds = new Set(["end"]);
  });

  test("REG-C04: end node — start() is NEVER called after completion", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-end", workflowRunId: "wf-end" });

    expect(workflowStartMock.mock.calls.length).toBe(0);
  });

  test("REG-C04: end node — no edge.evaluated event emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-end", workflowRunId: "wf-end" });

    const edgeEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.edge.evaluated",
    );
    expect(edgeEvents.length).toBe(0);
  });
});

// ── REG-C05: resolveGuardrails defaults ───────────────────────────────────────

describe("REG-C05: GUARDRAIL_DEFAULTS values are stable", () => {
  test("REG-C05: undefined guardrails → exactly 50 max steps, 10 max iterations, 2h duration", async () => {
    const { resolveGuardrails } = await chainPromise;
    const r = resolveGuardrails(undefined);
    expect(r.maxStepsPerRun).toBe(50);
    expect(r.maxIterations).toBe(10);
    expect(r.maxRunDurationMs).toBe(7_200_000); // 2 * 60 * 60 * 1000
  });
});

// ── REG-C06: run.started exactly once ────────────────────────────────────────

describe("REG-C06: run.started emitted only for queued→running transition", () => {
  test("REG-C06: queued run emits run.started exactly once", async () => {
    reset();
    currentLoopRun = makeLoopRun({ status: "queued" });
    executorOutcomes["work"] = { outcome: "success" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    const started = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(started.length).toBe(1);
  });

  test("REG-C06: already running → no run.started emitted", async () => {
    reset();
    currentLoopRun = makeLoopRun({ status: "running" });
    executorOutcomes["work"] = { outcome: "success" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    const started = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(started.length).toBe(0);
  });
});

// ── REG-C07: chain_route_missing uses distinct event name ─────────────────────

describe("REG-C07: chain_route_missing observability — distinct event for dangling edges", () => {
  beforeEach(() => {
    reset();

    // Definition with a dangling success edge (target not in nodes)
    currentLoopRun = makeLoopRun({
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
        ],
        edges: [
          { id: "e1", source: "start", target: "work", when: "success" },
          { id: "e2", source: "work", target: "phantom", when: "success" }, // dangling
        ],
      },
    });

    executorOutcomes["work"] = { outcome: "success" };
  });

  test("REG-C07: emits agent-loop.chain.route_missing (not a generic failure event)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // MUST be this exact event name — not "agent-loop.run.failed" or similar
    const routeMissing = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.route_missing",
    );
    expect(routeMissing).toBeDefined();
    expect(routeMissing?.status).toBe("failed");

    // Run must also be set to failed with chain_route_missing errorKind
    const failed = recordedRunStatusUpdates.find(
      (u) => u.status === "failed" && u.errorKind === "chain_route_missing",
    );
    expect(failed).toBeDefined();
  });
});
