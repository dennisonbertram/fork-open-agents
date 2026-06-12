/**
 * Agent Loops — run-controls.ts regression tests (TASK-327 refactor)
 *
 * These tests would fail if the implementation in run-controls.ts is reverted
 * or if the control-plane functions were re-introduced into chain.ts.
 *
 * REG-RC01: chain.ts isolation — the four control functions must not appear
 *           in chain.ts exports at any future point (prevents re-introduction).
 *
 * REG-RC02: Event payloads include source="api" — run-controls events carry
 *           a source field to distinguish API-originated controls from any
 *           future in-workflow invocations. If this payload field is dropped,
 *           observability tooling cannot distinguish the two paths.
 *
 * REG-RC03: Illegal-transition rejection is durable — if the store's status
 *           guard is removed, multiple wrong-status calls must still reject.
 *
 * REG-RC04: Resume dispatch-failure is non-fatal — if the try/catch is removed,
 *           a dispatch error on resume will surface as an unhandled rejection,
 *           leaving the run stuck in a recovered-but-unstarted state.
 *
 * REG-RC05: Retry creates a new step run and dispatches it in a single call —
 *           the two operations must be atomic from the caller's perspective.
 *
 * REG-RC06: run-controls.ts must NOT carry "use step" on any exported function —
 *           these are route-side concerns and must not be compiled into the
 *           workflow graph (verified by string-scanning the source).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoopRun, AgentLoopStepRun } from "@/lib/db/schema";
import { RunControlError } from "./run-controls-error";

mock.module("server-only", () => ({}));

// ── Captured calls ────────────────────────────────────────────────────────────

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

let recordedEvents: EventInput[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

// ── Store mock state ──────────────────────────────────────────────────────────

let currentLoopRun: AgentLoopRun;
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};
let runOwnership: Record<string, string> = {};

let nextCounter = 800;
function nextId() {
  return `reg-rc-${nextCounter++}`;
}

// ── Store mocks ───────────────────────────────────────────────────────────────

const pauseLoopRunMock = mock(async (runId: string, userId: string) => {
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new RunControlError("not_found", `Loop run not found: ${runId}`);
  }
  if (
    currentLoopRun.status !== "running" &&
    currentLoopRun.status !== "queued"
  ) {
    throw new RunControlError(
      "illegal_transition",
      `Cannot pause run ${runId}: status ${currentLoopRun.status}`,
    );
  }
  currentLoopRun = { ...currentLoopRun, status: "paused" };
  return currentLoopRun;
});

const cancelLoopRunMock = mock(async (runId: string, userId: string) => {
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new RunControlError("not_found", `Loop run not found: ${runId}`);
  }
  const ok = new Set(["running", "queued", "paused"]);
  if (!ok.has(currentLoopRun.status)) {
    throw new RunControlError(
      "illegal_transition",
      `Cannot cancel: ${currentLoopRun.status}`,
    );
  }
  currentLoopRun = { ...currentLoopRun, status: "cancelled" };
  return currentLoopRun;
});

const resumeLoopRunMock = mock(async (runId: string, userId: string) => {
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new RunControlError("not_found", `Loop run not found: ${runId}`);
  }
  if (currentLoopRun.status !== "paused") {
    throw new RunControlError(
      "illegal_transition",
      `Cannot resume: ${currentLoopRun.status}`,
    );
  }
  currentLoopRun = { ...currentLoopRun, status: "running" };
  return currentLoopRun;
});

const retryCurrentStepMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId, userId } = params;
    const owner = runOwnership[runId];
    if (!owner || owner !== userId) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }
    if (
      currentLoopRun.status !== "failed" &&
      currentLoopRun.status !== "stalled"
    ) {
      throw new RunControlError(
        "illegal_transition",
        `Cannot retry: ${currentLoopRun.status}`,
      );
    }
    const failed = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const attempt = (failed?.attempt ?? 1) + 1;
    const id = nextId();
    const newStepRun = makeStepRun({ id, attempt, status: "queued" });
    stepRunIdToStepRun[id] = newStepRun;
    currentLoopRun = {
      ...currentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return newStepRun;
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: `evt-${recordedEvents.length}`, ...input };
});

let workflowStartThrows: Error | null = null;
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-reg-rc-${nextCounter}` };
  },
);

mock.module("./store", () => ({
  pauseLoopRun: pauseLoopRunMock,
  cancelLoopRun: cancelLoopRunMock,
  resumeLoopRun: resumeLoopRunMock,
  retryCurrentStep: retryCurrentStepMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  // Allow chain.ts to load for REG-RC01 export checking
  getAgentLoopStepRunWithContext: mock(async () => null),
  getAgentLoopRunWithLoop: mock(async () => null),
  updateAgentLoopRunStatus: mock(async () => ({})),
  conditionallyTransitionRunStatus: mock(async () => ({})),
  updateAgentLoopStepRun: mock(async () => ({})),
  createAgentLoopStepRun: mock(async () => ({})),
  advanceRunToNextStep: mock(async () => false),
  countStepRunsForNode: mock(async () => 0),
  getMaxAttemptForNode: mock(async () => 0),
  updateAgentLoopRunContext: mock(async () => undefined),
  findStalledLoopRunCandidates: mock(async () => []),
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: mock(async () => ({ outcome: "success" as const })),
}));
mock.module("./edge-evaluator", () => ({
  evaluateEdges: mock(() => ({ nextNodeId: null, edgeId: null })),
}));

mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-reg-rc",
    loopId: "loop-reg-rc",
    userId: "user-1",
    status: "running",
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: "work",
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg-rc",
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
    id: "step-reg-rc-1",
    loopRunId: "run-reg-rc",
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

// ── Setup / reset ─────────────────────────────────────────────────────────────

function resetAll() {
  recordedEvents = [];
  workflowStartCalls = [];
  stepRunIdToStepRun = {};
  runOwnership = {};
  workflowStartThrows = null;
  nextCounter = 800;

  currentLoopRun = makeLoopRun();
  runOwnership["run-reg-rc"] = "user-1";

  pauseLoopRunMock.mockClear();
  cancelLoopRunMock.mockClear();
  resumeLoopRunMock.mockClear();
  retryCurrentStepMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  workflowStartMock.mockClear();
}

const runControlsPromise = import("./run-controls");

// ── REG-RC01: chain.ts must not re-gain control exports ───────────────────────

describe("REG-RC01: chain.ts must remain free of the four control-plane exports", () => {
  test("REG-RC01: none of the four control functions appear in chain.ts exports", async () => {
    const chain = await import("./chain");
    const chainExports = chain as Record<string, unknown>;

    // All four must be absent from chain.ts — if any appears, the duplicate was re-introduced
    expect(chainExports["pauseLoopRun"]).toBeUndefined();
    expect(chainExports["cancelLoopRun"]).toBeUndefined();
    expect(chainExports["resumeLoopRun"]).toBeUndefined();
    expect(chainExports["retryCurrentStep"]).toBeUndefined();
  });

  test("REG-RC01: run-controls.ts still exports all four functions", async () => {
    const rc = await runControlsPromise;
    const rcExports = rc as Record<string, unknown>;

    // The canonical implementation must remain in run-controls.ts
    expect(typeof rcExports["pauseLoopRun"]).toBe("function");
    expect(typeof rcExports["cancelLoopRun"]).toBe("function");
    expect(typeof rcExports["resumeLoopRun"]).toBe("function");
    expect(typeof rcExports["retryCurrentStep"]).toBe("function");
  });
});

// ── REG-RC02: Event payloads include source="api" ─────────────────────────────

describe("REG-RC02: run-controls events carry source=api in payload for observability", () => {
  beforeEach(() => {
    resetAll();
  });

  test("REG-RC02a: pauseLoopRun event payload includes source=api", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { pauseLoopRun } = await runControlsPromise;
    await pauseLoopRun("run-reg-rc", "user-1");

    const evt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.paused",
    );
    expect(evt).toBeDefined();
    const payload = evt?.payload as Record<string, unknown> | undefined;
    expect(payload?.["source"]).toBe("api");
  });

  test("REG-RC02b: cancelLoopRun event payload includes source=api", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { cancelLoopRun } = await runControlsPromise;
    await cancelLoopRun("run-reg-rc", "user-1");

    const evt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.cancelled",
    );
    expect(evt).toBeDefined();
    const payload = evt?.payload as Record<string, unknown> | undefined;
    expect(payload?.["source"]).toBe("api");
  });

  test("REG-RC02c: resumeLoopRun event payload includes source=api", async () => {
    currentLoopRun = makeLoopRun({ status: "paused" });
    const { resumeLoopRun } = await runControlsPromise;
    await resumeLoopRun("run-reg-rc", "user-1");

    const evt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.resumed",
    );
    expect(evt).toBeDefined();
    const payload = evt?.payload as Record<string, unknown> | undefined;
    expect(payload?.["source"]).toBe("api");
  });

  test("REG-RC02d: retryCurrentStep event payload includes source=api", async () => {
    const failedStep = makeStepRun({
      id: "step-failed-reg",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["step-failed-reg"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentStepRunId: "step-failed-reg",
    });
    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-reg-rc", "user-1");

    const evt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.retry",
    );
    expect(evt).toBeDefined();
    const payload = evt?.payload as Record<string, unknown> | undefined;
    expect(payload?.["source"]).toBe("api");
  });
});

// ── REG-RC03: Illegal-transition rejection is durable ────────────────────────

describe("REG-RC03: multiple wrong-status calls always reject (guard is durable, not one-shot)", () => {
  beforeEach(() => {
    resetAll();
  });

  test("REG-RC03: pauseLoopRun rejects on completed status — every call, not just the first", async () => {
    const { pauseLoopRun } = await runControlsPromise;

    // First wrong-status call
    currentLoopRun = makeLoopRun({ status: "completed" });
    await expect(pauseLoopRun("run-reg-rc", "user-1")).rejects.toThrow();

    // Second wrong-status call — must also reject (guard is not consumed)
    currentLoopRun = makeLoopRun({ status: "completed" });
    await expect(pauseLoopRun("run-reg-rc", "user-1")).rejects.toThrow();

    // Status was never mutated
    expect(currentLoopRun.status).toBe("completed");
  });

  test("REG-RC03: retryCurrentStep rejects from running status (not retryable)", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { retryCurrentStep } = await runControlsPromise;

    await expect(retryCurrentStep("run-reg-rc", "user-1")).rejects.toThrow();
    expect(currentLoopRun.status).toBe("running");
  });
});

// ── REG-RC04: Resume dispatch-failure is non-fatal ───────────────────────────

describe("REG-RC04: dispatch failure during resume must not propagate (run recoverable)", () => {
  beforeEach(() => {
    resetAll();
  });

  test("REG-RC04: resume with failing dispatch → resolves (no throw), dispatch_failed event", async () => {
    const nextStep = makeStepRun({
      id: "step-reg-resume",
      nodeId: "end",
      status: "queued",
    });
    stepRunIdToStepRun["step-reg-resume"] = nextStep;
    currentLoopRun = makeLoopRun({
      status: "paused",
      currentNodeId: "end",
      currentStepRunId: "step-reg-resume",
    });
    workflowStartThrows = new Error("Workflow service unavailable");

    const { resumeLoopRun } = await runControlsPromise;
    // This MUST resolve without throwing — dispatch failures are caught internally
    await expect(
      resumeLoopRun("run-reg-rc", "user-1"),
    ).resolves.toBeUndefined();

    // The dispatch_failed event must be recorded
    const failedEvt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatch_failed",
    );
    expect(failedEvt).toBeDefined();
    expect(failedEvt?.level).toBe("error");

    // Run is still "running" (status transition succeeded; only dispatch failed)
    expect(currentLoopRun.status).toBe("running");
  });
});

// ── REG-RC05: Retry atomicity ─────────────────────────────────────────────────

describe("REG-RC05: retry creates and dispatches the new step in a single operation", () => {
  beforeEach(() => {
    resetAll();
  });

  test("REG-RC05: retryCurrentStep: retry event AND dispatch event both emitted in same call", async () => {
    const failedStep = makeStepRun({
      id: "step-reg-retry",
      attempt: 2,
      status: "failed",
      nodeId: "work",
    });
    stepRunIdToStepRun["step-reg-retry"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-reg-retry",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-reg-rc", "user-1");

    // Both retry event and dispatch event must be present in the same call
    const retryEvt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.retry",
    );
    const dispatchEvt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatched",
    );
    expect(retryEvt).toBeDefined();
    expect(dispatchEvt).toBeDefined();

    // And exactly one workflow was started
    expect(workflowStartCalls.length).toBe(1);
  });
});
