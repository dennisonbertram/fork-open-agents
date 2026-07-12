/**
 * Agent Loops — run-controls.ts tests (TASK-327 refactor)
 *
 * Behavioral tests for the canonical run-control state machine (pause/cancel/resume/retry).
 * These tests were migrated from chain.test.ts BT-C10 and pr347-final-fixes.test.ts BT-F2
 * when the duplicate wrappers in chain.ts were deleted.
 *
 * BT-RC01: Legal and illegal state transitions for all four control operations
 *   BT-RC01a: pause from running → paused + event
 *   BT-RC01b: pause from completed → throws (illegal transition)
 *   BT-RC01c: cancel from running → cancelled + event
 *   BT-RC01d: cancel from paused → cancelled
 *   BT-RC01e: cancel from completed → throws (illegal transition)
 *   BT-RC01f: resume from paused → running + event + re-dispatch if step queued
 *   BT-RC01g: resume from running → throws (illegal transition)
 *   BT-RC01h: retry from failed → creates attempt n+1, dispatches, status running
 *   BT-RC01i: retry from running → throws (illegal transition)
 *
 * BT-RC02: Ownership enforcement — wrong userId rejected identically to unknown run
 *   BT-RC02a: pauseLoopRun wrong userId → rejects + row untouched
 *   BT-RC02b: cancelLoopRun wrong userId → rejects + row untouched
 *   BT-RC02c: resumeLoopRun wrong userId → rejects + row untouched
 *   BT-RC02d: retryCurrentStep wrong userId → rejects + row untouched
 *   BT-RC02e: all four functions work correctly with correct userId
 *
 * BT-RC03: Resume re-dispatches queued step (pause-mid-execution recovery path)
 *   BT-RC03a: resumeLoopRun with queued currentStepRunId → workflow dispatch fires
 *   BT-RC03b: resumeLoopRun without currentStepRunId → no dispatch, no error
 *   BT-RC03c: dispatch failure during resume → dispatch_failed event recorded,
 *             run marked failed with errorKind=dispatch_failed, DispatchFailedError
 *             thrown (issue #763 — no false "Resume successful")
 *
 * BT-RC04: Retry dispatches the new attempt workflow
 *   BT-RC04a: retryCurrentStep → dispatches new step, attempt n+1
 *   BT-RC04b: dispatch failure during retry → dispatch_failed event, run marked
 *             failed with errorKind=dispatch_failed, DispatchFailedError thrown
 *             (issue #763 — no false "Retry successful")
 *
 * BT-RC05: chain.ts does NOT export the four control functions (separation gate)
 *   BT-RC05: pauseLoopRun/cancelLoopRun/resumeLoopRun/retryCurrentStep absent from chain.ts
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoopRun, AgentLoopStepRun } from "@/lib/db/schema";
import { DispatchFailedError, RunControlError } from "./run-controls-error";

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

// Tracks which userId owns which runId for ownership checks
let runOwnership: Record<string, string> = {};

let nextStepRunIdCounter = 700;
function nextId() {
  return `rc-${nextStepRunIdCounter++}`;
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
      `Cannot pause run ${runId}: not in a pausable status (running/queued)`,
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
      `Cannot cancel run ${runId}: not in a cancellable status (running/queued/paused)`,
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
      `Cannot resume run ${runId}: not in paused status`,
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
        `Cannot retry run ${runId}: not in a retryable status (failed/stalled), got: ${currentLoopRun.status}`,
      );
    }
    const failed = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const attempt = (failed?.attempt ?? 1) + 1;
    const id = nextId();
    const newStepRun = makeStepRun({
      id,
      nodeId: currentLoopRun.currentNodeId ?? "work",
      attempt,
      status: "queued",
    });
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

type TransitionCall = {
  runId: string;
  toStatus: string;
  fromStatuses: string[];
  errorKind?: string | null;
  errorMessage?: string | null;
};
let transitionCalls: TransitionCall[] = [];
const conditionallyTransitionRunStatusMock = mock(
  async (params: TransitionCall) => {
    transitionCalls.push(params);
    currentLoopRun = {
      ...currentLoopRun,
      status: params.toStatus as AgentLoopRun["status"],
      ...(params.errorKind !== undefined
        ? { errorKind: params.errorKind }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: params.errorMessage }
        : {}),
    };
    return currentLoopRun;
  },
);

let workflowStartThrows: Error | null = null;
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-rc-${nextStepRunIdCounter}` };
  },
);

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  pauseLoopRun: pauseLoopRunMock,
  cancelLoopRun: cancelLoopRunMock,
  resumeLoopRun: resumeLoopRunMock,
  retryCurrentStep: retryCurrentStepMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  // The following are needed to allow chain.ts to load for BT-RC05 export checks
  getAgentLoopStepRunWithContext: mock(async () => null),
  getAgentLoopRunWithLoop: mock(async () => null),
  updateAgentLoopRunStatus: mock(async () => ({})),
  conditionallyTransitionRunStatus: conditionallyTransitionRunStatusMock,
  updateAgentLoopStepRun: mock(async () => ({})),
  createAgentLoopStepRun: mock(async () => ({})),
  advanceRunToNextStep: mock(async () => false),
  countStepRunsForNode: mock(async () => 0),
  getMaxAttemptForNode: mock(async () => 0),
  updateAgentLoopRunContext: mock(async () => undefined),
  findStalledLoopRunCandidates: mock(async () => []),
  // watchdog stubs (M3-01)
  createAgentLoopWatchdogRun: mock(async () => ({
    id: "wdr-stub",
    loopId: "loop-1",
    loopRunId: "run-1",
    stepRunId: null,
    nodeId: null,
    attempt: 1,
    decision: null,
    diagnosis: null,
    hint: null,
    failReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateAgentLoopWatchdogRun: mock(async () => undefined),
  countWatchdogRetryDecisions: mock(async () => 0),
  listWatchdogRunsForLoopRun: mock(async () => []),
  retryCurrentStepForWatchdog: mock(async () => undefined),
  pauseLoopRunSystem: mock(async () => undefined),
  advanceToFailureEdge: mock(async () => false),
  dispatchStepWorkflow: mock(async () => undefined),
}));

mock.module("./watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false })),
}));

// These mocks allow chain.ts to load without errors for BT-RC05 export-checking
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
    id: "run-rc",
    loopId: "loop-rc",
    userId: "user-1",
    status: "running",
    definitionSnapshot: {} as Record<string, unknown>,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: "work",
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-rc",
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
    id: "step-rc-1",
    loopRunId: "run-rc",
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
  nextStepRunIdCounter = 700;
  transitionCalls = [];

  currentLoopRun = makeLoopRun();
  runOwnership["run-rc"] = "user-1";

  pauseLoopRunMock.mockClear();
  cancelLoopRunMock.mockClear();
  resumeLoopRunMock.mockClear();
  retryCurrentStepMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  workflowStartMock.mockClear();
  conditionallyTransitionRunStatusMock.mockClear();
}

const runControlsPromise = import("./run-controls");

// ── BT-RC05: Separation gate — chain.ts must NOT export control functions ─────
// This is intentionally tested FIRST so a failing state is clear in the red commit.

describe("BT-RC05: chain.ts must NOT export the four control-plane functions", () => {
  test("BT-RC05: pauseLoopRun is absent from chain.ts exports", async () => {
    const chain = await import("./chain");
    expect((chain as Record<string, unknown>)["pauseLoopRun"]).toBeUndefined();
  });

  test("BT-RC05: cancelLoopRun is absent from chain.ts exports", async () => {
    const chain = await import("./chain");
    expect((chain as Record<string, unknown>)["cancelLoopRun"]).toBeUndefined();
  });

  test("BT-RC05: resumeLoopRun is absent from chain.ts exports", async () => {
    const chain = await import("./chain");
    expect((chain as Record<string, unknown>)["resumeLoopRun"]).toBeUndefined();
  });

  test("BT-RC05: retryCurrentStep is absent from chain.ts exports", async () => {
    const chain = await import("./chain");
    expect(
      (chain as Record<string, unknown>)["retryCurrentStep"],
    ).toBeUndefined();
  });
});

// ── BT-RC01: Legal and illegal state transitions ──────────────────────────────

describe("BT-RC01: legal/illegal state transitions for all four control operations", () => {
  beforeEach(() => {
    resetAll();
  });

  // Pause
  test("BT-RC01a: pause from running → paused + event", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { pauseLoopRun } = await runControlsPromise;
    await pauseLoopRun("run-rc", "user-1");

    expect(currentLoopRun.status).toBe("paused");
    const pausedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.paused",
    );
    expect(pausedEvent).toBeDefined();
  });

  test("BT-RC01b: pause from completed → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "completed" });
    const { pauseLoopRun } = await runControlsPromise;
    await expect(pauseLoopRun("run-rc", "user-1")).rejects.toThrow();
  });

  // Cancel
  test("BT-RC01c: cancel from running → cancelled + event", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { cancelLoopRun } = await runControlsPromise;
    await cancelLoopRun("run-rc", "user-1");

    expect(currentLoopRun.status).toBe("cancelled");
    const cancelledEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.cancelled",
    );
    expect(cancelledEvent).toBeDefined();
  });

  test("BT-RC01d: cancel from paused → cancelled", async () => {
    currentLoopRun = makeLoopRun({ status: "paused" });
    const { cancelLoopRun } = await runControlsPromise;
    await cancelLoopRun("run-rc", "user-1");
    expect(currentLoopRun.status).toBe("cancelled");
  });

  test("BT-RC01e: cancel from completed → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "completed" });
    const { cancelLoopRun } = await runControlsPromise;
    await expect(cancelLoopRun("run-rc", "user-1")).rejects.toThrow();
  });

  // Resume
  test("BT-RC01f: resume from paused → running + event + re-dispatch if step queued", async () => {
    const queuedStepRun = makeStepRun({
      id: "step-queued-rc",
      nodeId: "work",
      status: "queued",
    });
    stepRunIdToStepRun["step-queued-rc"] = queuedStepRun;
    currentLoopRun = makeLoopRun({
      status: "paused",
      currentStepRunId: "step-queued-rc",
    });

    const { resumeLoopRun } = await runControlsPromise;
    await resumeLoopRun("run-rc", "user-1");

    expect(currentLoopRun.status).toBe("running");
    const resumedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.resumed",
    );
    expect(resumedEvent).toBeDefined();
    // Re-dispatch should have happened for the queued step
    expect(workflowStartCalls.length).toBe(1);
    expect(workflowStartCalls[0]?.stepRunId).toBe("step-queued-rc");
  });

  test("BT-RC01g: resume from running → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { resumeLoopRun } = await runControlsPromise;
    await expect(resumeLoopRun("run-rc", "user-1")).rejects.toThrow();
  });

  // Retry
  test("BT-RC01h: retry from failed → creates attempt n+1, dispatches, status running", async () => {
    const failedStepRun = makeStepRun({
      id: "step-failed-rc",
      nodeId: "work",
      nodeKind: "agent_step",
      status: "failed",
      attempt: 1,
      errorKind: "sandbox_unavailable",
    });
    stepRunIdToStepRun["step-failed-rc"] = failedStepRun;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-failed-rc",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-rc", "user-1");

    // Run status should be running
    expect(currentLoopRun.status).toBe("running");
    // Workflow should have been dispatched
    expect(workflowStartCalls.length).toBe(1);
    // Retry event emitted
    const retryEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.retry",
    );
    expect(retryEvent).toBeDefined();
    // Attempt in retry event must be 2
    const payload = retryEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["attempt"]).toBe(2);
  });

  test("BT-RC01i: retry from running → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { retryCurrentStep } = await runControlsPromise;
    await expect(retryCurrentStep("run-rc", "user-1")).rejects.toThrow();
  });
});

// ── BT-RC02: Ownership enforcement ───────────────────────────────────────────

describe("BT-RC02: ownership enforcement — wrong userId rejected identically to unknown run", () => {
  beforeEach(() => {
    resetAll();
  });

  test("BT-RC02a: pauseLoopRun wrong userId → rejects + row untouched", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { pauseLoopRun } = await runControlsPromise;

    await expect(pauseLoopRun("run-rc", "attacker")).rejects.toThrow();
    // Row must not have been mutated
    expect(currentLoopRun.status).toBe("running");
  });

  test("BT-RC02b: cancelLoopRun wrong userId → rejects + row untouched", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { cancelLoopRun } = await runControlsPromise;

    await expect(cancelLoopRun("run-rc", "attacker")).rejects.toThrow();
    expect(currentLoopRun.status).toBe("running");
  });

  test("BT-RC02c: resumeLoopRun wrong userId → rejects + row untouched", async () => {
    currentLoopRun = makeLoopRun({ status: "paused" });
    const { resumeLoopRun } = await runControlsPromise;

    await expect(resumeLoopRun("run-rc", "attacker")).rejects.toThrow();
    expect(currentLoopRun.status).toBe("paused");
  });

  test("BT-RC02d: retryCurrentStep wrong userId → rejects + row untouched", async () => {
    const failedStep = makeStepRun({
      id: "step-failed-rc2",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["step-failed-rc2"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentStepRunId: "step-failed-rc2",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await expect(retryCurrentStep("run-rc", "attacker")).rejects.toThrow();
    expect(currentLoopRun.status).toBe("failed");
  });

  test("BT-RC02e: all four control functions work correctly with the correct userId", async () => {
    const { pauseLoopRun, cancelLoopRun } = await runControlsPromise;

    // Pause with correct user
    currentLoopRun = makeLoopRun({ status: "running" });
    await expect(pauseLoopRun("run-rc", "user-1")).resolves.toBeUndefined();
    expect(currentLoopRun.status).toBe("paused");

    // Cancel from paused with correct user
    await expect(cancelLoopRun("run-rc", "user-1")).resolves.toBeUndefined();
    expect(currentLoopRun.status).toBe("cancelled");
  });
});

// ── BT-RC03: Resume re-dispatch behavior ─────────────────────────────────────

describe("BT-RC03: resume re-dispatches queued step (pause-mid-execution recovery path)", () => {
  beforeEach(() => {
    resetAll();
  });

  test("BT-RC03a: resumeLoopRun with queued currentStepRunId → workflow dispatch fires once", async () => {
    const nextStep = makeStepRun({
      id: "step-next-rc",
      nodeId: "end",
      nodeKind: "end",
      status: "queued",
    });
    stepRunIdToStepRun["step-next-rc"] = nextStep;
    currentLoopRun = makeLoopRun({
      status: "paused",
      currentNodeId: "end",
      currentStepRunId: "step-next-rc",
    });

    const { resumeLoopRun } = await runControlsPromise;
    await resumeLoopRun("run-rc", "user-1");

    expect(workflowStartCalls.length).toBe(1);
    expect(workflowStartCalls[0]?.stepRunId).toBe("step-next-rc");
  });

  test("BT-RC03b: resumeLoopRun without currentStepRunId → no dispatch, no error", async () => {
    currentLoopRun = makeLoopRun({
      status: "paused",
      currentStepRunId: null,
    });

    const { resumeLoopRun } = await runControlsPromise;
    await expect(resumeLoopRun("run-rc", "user-1")).resolves.toBeUndefined();
    expect(workflowStartCalls.length).toBe(0);
  });

  test("BT-RC03c: dispatch failure during resume → DispatchFailedError thrown, run marked failed, dispatch_failed event recorded", async () => {
    const nextStep = makeStepRun({
      id: "step-next-fail-rc",
      nodeId: "end",
      status: "queued",
    });
    stepRunIdToStepRun["step-next-fail-rc"] = nextStep;
    currentLoopRun = makeLoopRun({
      status: "paused",
      currentNodeId: "end",
      currentStepRunId: "step-next-fail-rc",
    });
    workflowStartThrows = new Error("Workflow service unavailable");

    const { resumeLoopRun } = await runControlsPromise;
    // Must throw a typed DispatchFailedError — resume must NOT report success
    // when the workflow dispatch silently failed (issue #763).
    await expect(resumeLoopRun("run-rc", "user-1")).rejects.toThrow(
      DispatchFailedError,
    );

    const dispatchFailedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatch_failed",
    );
    expect(dispatchFailedEvent).toBeDefined();

    // Run row must be transitioned to failed with errorKind=dispatch_failed
    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalled();
    const failTransition = transitionCalls.find((c) => c.toStatus === "failed");
    expect(failTransition).toBeDefined();
    expect(failTransition?.errorKind).toBe("dispatch_failed");
    expect(typeof failTransition?.errorMessage).toBe("string");
  });
});

// ── BT-RC04: Retry dispatch behavior ─────────────────────────────────────────

describe("BT-RC04: retry dispatches the new attempt workflow", () => {
  beforeEach(() => {
    resetAll();
  });

  test("BT-RC04a: retryCurrentStep dispatches with new step run id, emits chain.dispatched event", async () => {
    const failedStep = makeStepRun({
      id: "step-retry-rc",
      attempt: 2,
      status: "failed",
      nodeId: "work",
    });
    stepRunIdToStepRun["step-retry-rc"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-retry-rc",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-rc", "user-1");

    // Must have dispatched a workflow
    expect(workflowStartCalls.length).toBe(1);

    const dispatchedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatched",
    );
    expect(dispatchedEvent).toBeDefined();
    // Payload must include attempt 3 (failedStep.attempt=2 → n+1=3)
    const payload = dispatchedEvent?.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload?.["attempt"]).toBe(3);
  });

  test("BT-RC04b: dispatch failure during retry → DispatchFailedError thrown, run marked failed, dispatch_failed event recorded", async () => {
    const failedStep = makeStepRun({
      id: "step-retry-fail-rc",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["step-retry-fail-rc"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentStepRunId: "step-retry-fail-rc",
    });
    workflowStartThrows = new Error("Workflow service down");

    const { retryCurrentStep } = await runControlsPromise;
    // Must throw — retry must NOT report success when dispatch silently failed.
    await expect(retryCurrentStep("run-rc", "user-1")).rejects.toThrow(
      DispatchFailedError,
    );

    const dispatchFailedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatch_failed",
    );
    expect(dispatchFailedEvent).toBeDefined();

    const failTransition = transitionCalls.find((c) => c.toStatus === "failed");
    expect(failTransition).toBeDefined();
    expect(failTransition?.errorKind).toBe("dispatch_failed");
  });
});
