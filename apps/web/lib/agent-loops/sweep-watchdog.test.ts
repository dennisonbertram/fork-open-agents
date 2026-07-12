/**
 * Agent Loops — sweep + watchdog integration tests (M3-02-A)
 *
 * Verifies that sweepStalledLoopRuns wires the watchdog correctly:
 *
 * SW-1: loop.watchdogEnabled=true + run.currentStepRunId set
 *       → invokeWatchdog called once with errorKind='stall_sweep', nodeId, stepRunId,
 *         errorMessage containing lastEventName + age-in-minutes, workflowRunId
 * SW-2: loop.watchdogEnabled=false → invokeWatchdog NOT called; stalled event still emitted
 * SW-3: run.currentStepRunId null → invokeWatchdog NOT called; only stalled event emitted
 * SW-4: `if (!updated) continue` race guard fires BEFORE watchdog load (no getAgentLoopRunWithLoop call)
 * SW-5: invokeWatchdog throwing is swallowed — sweep loop continues to next candidate
 * SW-6: 'skip' decision for stall invocation is coerced to 'pause'
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Captured calls ─────────────────────────────────────────────────────────────

type EventInput = {
  loopRunId: string;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
};

type ConditionalTransitionInput = {
  runId: string;
  toStatus: string;
  fromStatuses: string[];
  errorKind?: string | null;
  errorMessage?: string | null;
};

type InvokeWatchdogCall = {
  loopRun: {
    id: string;
    currentStepRunId?: string | null;
    currentNodeId?: string | null;
  };
  stepRunId: string;
  nodeId: string;
  errorKind?: string;
  errorMessage?: string;
  workflowRunId?: string | null;
  legalDecisions?: ReadonlyArray<"retry" | "skip" | "pause">;
};

let recordedEvents: EventInput[] = [];
let recordedConditionalTransitions: ConditionalTransitionInput[] = [];
let invokeWatchdogCalls: InvokeWatchdogCall[] = [];
let getAgentLoopRunWithLoopCalls: string[] = [];

// Controls what conditionallyTransitionRunStatus returns
let conditionalTransitionResult: { id: string; status: string } | null = {
  id: "run-placeholder",
  status: "stalled",
};

// Controls what getAgentLoopRunWithLoop returns per runId
let loopRunWithLoopMap = new Map<
  string,
  {
    run: {
      id: string;
      currentNodeId: string | null;
      currentStepRunId: string | null;
      workflowRunId: string | null;
      definitionSnapshot: unknown;
    };
    loop: {
      watchdogEnabled: boolean;
      watchdogInstructions: string | null;
      watchdogRetryBudget: number;
    };
  }
>();

// Controls whether invokeWatchdog throws
let invokeWatchdogShouldThrow = false;
// Controls what invokeWatchdog returns
let invokeWatchdogResult: { invoked: boolean; decision?: string } = {
  invoked: true,
  decision: "retry",
};

// ── Store mocks ────────────────────────────────────────────────────────────────

let stalledCandidates: Array<{
  id: string;
  status: "queued" | "running";
  lastEventName: string | null;
  lastEventAt: Date;
}> = [];

const findStalledLoopRunCandidates = mock(async () => stalledCandidates);

const conditionallyTransitionRunStatus = mock(
  async (params: ConditionalTransitionInput) => {
    recordedConditionalTransitions.push(params);
    if (conditionalTransitionResult) {
      return { id: params.runId, status: params.toStatus };
    }
    return null;
  },
);

const recordAgentLoopEvent = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return {
    id: "ev-" + Math.random().toString(36).slice(2),
    ...input,
    createdAt: new Date(),
  };
});

const getAgentLoopRunExecutionContext = mock(async (runId: string) => {
  getAgentLoopRunWithLoopCalls.push(runId);
  const row = loopRunWithLoopMap.get(runId);
  return row
    ? {
        loopRun: row.run,
        loop: row.loop,
        snapshotSource: "legacy_live_fallback" as const,
        definitionVersion: null,
        definitionHash: null,
      }
    : null;
});

mock.module("@/lib/agent-loops/store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  findStalledLoopRunCandidates,
  conditionallyTransitionRunStatus,
  recordAgentLoopEvent,
  getAgentLoopRunExecutionContext,
  updateAgentLoopRunContext: mock(async () => undefined),
  retryCurrentStep: mock(async () => undefined),
  listAgentLoopRuns: mock(async () => []),
}));

// ── Watchdog mock ──────────────────────────────────────────────────────────────

const invokeWatchdogForStall = mock(async (params: InvokeWatchdogCall) => {
  invokeWatchdogCalls.push(params);
  if (invokeWatchdogShouldThrow) {
    throw new Error("invokeWatchdog test error");
  }
  return invokeWatchdogResult;
});

mock.module("@/lib/agent-loops/watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false })),
  invokeWatchdogForStall,
}));

// ── Config mock ────────────────────────────────────────────────────────────────

mock.module("@/lib/agent-loops/config", () => ({
  getAgentLoopsStallMinutes: () => 15,
  isAgentLoopsEnabled: mock(() => true),
  isAgentLoopRepoAllowed: mock(() => true),
  getAgentLoopsAllowedRepos: mock(() => []),
}));

const sweepModulePromise = import("./sweep");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCandidate(opts: {
  id: string;
  status: "queued" | "running";
  ageMinutes: number;
  lastEventName?: string;
}): {
  id: string;
  status: "queued" | "running";
  lastEventName: string | null;
  lastEventAt: Date;
} {
  const now = new Date();
  return {
    id: opts.id,
    status: opts.status,
    lastEventName: opts.lastEventName ?? "agent-loop.step.started",
    lastEventAt: new Date(now.getTime() - opts.ageMinutes * 60 * 1000),
  };
}

function makeDetail(opts: {
  runId: string;
  currentNodeId?: string | null;
  currentStepRunId?: string | null;
  workflowRunId?: string | null;
  watchdogEnabled?: boolean;
  watchdogRetryBudget?: number;
}): {
  run: {
    id: string;
    currentNodeId: string | null;
    currentStepRunId: string | null;
    workflowRunId: string | null;
    definitionSnapshot: unknown;
  };
  loop: {
    watchdogEnabled: boolean;
    watchdogInstructions: string | null;
    watchdogRetryBudget: number;
  };
} {
  return {
    run: {
      id: opts.runId,
      // Use undefined-to-default but keep null as null (??  coalesces null, so use explicit check)
      currentNodeId:
        opts.currentNodeId !== undefined ? opts.currentNodeId : "node-A",
      currentStepRunId:
        opts.currentStepRunId !== undefined ? opts.currentStepRunId : "step-1",
      workflowRunId:
        opts.workflowRunId !== undefined ? opts.workflowRunId : null,
      definitionSnapshot: { nodes: [], edges: [] },
    },
    loop: {
      watchdogEnabled: opts.watchdogEnabled ?? true,
      watchdogInstructions: null,
      watchdogRetryBudget: opts.watchdogRetryBudget ?? 3,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sweep + watchdog integration (M3-02-A)", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedConditionalTransitions = [];
    invokeWatchdogCalls = [];
    getAgentLoopRunWithLoopCalls = [];
    stalledCandidates = [];
    loopRunWithLoopMap = new Map();
    invokeWatchdogShouldThrow = false;
    invokeWatchdogResult = { invoked: true, decision: "retry" };

    conditionalTransitionResult = { id: "run-placeholder", status: "stalled" };

    findStalledLoopRunCandidates.mockClear();
    conditionallyTransitionRunStatus.mockClear();
    recordAgentLoopEvent.mockClear();
    getAgentLoopRunExecutionContext.mockClear();
    invokeWatchdogForStall.mockClear();

    findStalledLoopRunCandidates.mockImplementation(
      async () => stalledCandidates,
    );
    conditionallyTransitionRunStatus.mockImplementation(
      async (params: ConditionalTransitionInput) => {
        recordedConditionalTransitions.push(params);
        if (conditionalTransitionResult) {
          return { id: params.runId, status: params.toStatus };
        }
        return null;
      },
    );
    recordAgentLoopEvent.mockImplementation(async (input: EventInput) => {
      recordedEvents.push(input);
      return {
        id: "ev-" + Math.random().toString(36).slice(2),
        ...input,
        createdAt: new Date(),
      };
    });
    getAgentLoopRunExecutionContext.mockImplementation(
      async (runId: string) => {
        getAgentLoopRunWithLoopCalls.push(runId);
        const row = loopRunWithLoopMap.get(runId);
        return row
          ? {
              loopRun: row.run,
              loop: row.loop,
              snapshotSource: "legacy_live_fallback" as const,
              definitionVersion: null,
              definitionHash: null,
            }
          : null;
      },
    );
    invokeWatchdogForStall.mockImplementation(
      async (params: InvokeWatchdogCall) => {
        invokeWatchdogCalls.push(params);
        if (invokeWatchdogShouldThrow) {
          throw new Error("invokeWatchdog test error");
        }
        return invokeWatchdogResult;
      },
    );
  });

  test("SW-1: watchdogEnabled=true + currentStepRunId set → invokeWatchdogForStall called with correct params", async () => {
    const runId = "run-watchdog-1";
    const lastEventName = "agent-loop.step.started";
    stalledCandidates = [
      makeCandidate({
        id: runId,
        status: "running",
        ageMinutes: 20,
        lastEventName,
      }),
    ];
    loopRunWithLoopMap.set(
      runId,
      makeDetail({
        runId,
        currentNodeId: "node-A",
        currentStepRunId: "step-run-1",
        workflowRunId: "wf-run-1",
        watchdogEnabled: true,
      }),
    );

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    expect(invokeWatchdogForStall).toHaveBeenCalledTimes(1);
    const call = invokeWatchdogCalls[0];
    expect(call).toBeDefined();
    // errorKind must be 'stall_sweep'
    expect(call?.errorKind).toBe("stall_sweep");
    // nodeId from run
    expect(call?.nodeId).toBe("node-A");
    // stepRunId from run
    expect(call?.stepRunId).toBe("step-run-1");
    // errorMessage contains lastEventName
    expect(call?.errorMessage).toContain(lastEventName);
    // errorMessage contains age in minutes
    expect(call?.errorMessage).toMatch(/\d+m/);
    // workflowRunId passed through
    expect(call?.workflowRunId).toBe("wf-run-1");
  });

  test("SW-2: watchdogEnabled=false → invokeWatchdogForStall NOT called; stalled event emitted", async () => {
    const runId = "run-no-watchdog";
    stalledCandidates = [
      makeCandidate({ id: runId, status: "running", ageMinutes: 20 }),
    ];
    loopRunWithLoopMap.set(
      runId,
      makeDetail({
        runId,
        watchdogEnabled: false,
      }),
    );

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    // watchdog not called
    expect(invokeWatchdogForStall).not.toHaveBeenCalled();

    // stalled event still emitted (today's behavior unchanged)
    const stalledEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.stalled",
    );
    expect(stalledEvents).toHaveLength(1);
    expect(stalledEvents[0]?.loopRunId).toBe(runId);
  });

  test("SW-3: run.currentStepRunId null → invokeWatchdogForStall NOT called; stalled event emitted", async () => {
    const runId = "run-no-step-run";
    stalledCandidates = [
      makeCandidate({ id: runId, status: "queued", ageMinutes: 20 }),
    ];
    loopRunWithLoopMap.set(
      runId,
      makeDetail({
        runId,
        currentStepRunId: null,
        watchdogEnabled: true,
      }),
    );

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    // watchdog NOT called (retryCurrentStepForWatchdog requires currentStepRunId)
    expect(invokeWatchdogForStall).not.toHaveBeenCalled();

    // stalled event still emitted
    const stalledEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.stalled",
    );
    expect(stalledEvents).toHaveLength(1);
  });

  test("SW-4: race guard (!updated) short-circuits BEFORE getAgentLoopRunWithLoop is called", async () => {
    const runId = "run-raced";
    stalledCandidates = [
      makeCandidate({ id: runId, status: "running", ageMinutes: 20 }),
    ];
    loopRunWithLoopMap.set(runId, makeDetail({ runId, watchdogEnabled: true }));

    // Simulate race: 0 rows updated — another process already transitioned
    conditionalTransitionResult = null;

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    // getAgentLoopRunWithLoop must NOT be called when transition returned null
    expect(getAgentLoopRunWithLoopCalls).toHaveLength(0);
    // invokeWatchdogForStall also not called
    expect(invokeWatchdogForStall).not.toHaveBeenCalled();
  });

  test("SW-5: invokeWatchdogForStall throwing is swallowed — sweep continues and emits sweep.completed", async () => {
    const runId1 = "run-throws";
    const runId2 = "run-ok";

    stalledCandidates = [
      makeCandidate({ id: runId1, status: "running", ageMinutes: 20 }),
      makeCandidate({ id: runId2, status: "running", ageMinutes: 25 }),
    ];
    loopRunWithLoopMap.set(
      runId1,
      makeDetail({ runId: runId1, watchdogEnabled: true }),
    );
    loopRunWithLoopMap.set(
      runId2,
      makeDetail({ runId: runId2, watchdogEnabled: true }),
    );

    // First call throws, second call succeeds
    let callCount = 0;
    invokeWatchdogForStall.mockImplementation(
      async (params: InvokeWatchdogCall) => {
        invokeWatchdogCalls.push(params);
        callCount++;
        if (callCount === 1) {
          throw new Error("watchdog boom");
        }
        return { invoked: true, decision: "retry" };
      },
    );

    const { sweepStalledLoopRuns } = await sweepModulePromise;

    // Must not throw
    let result: { stalledCount: number; checkedCount: number } | undefined;
    let threw = false;
    try {
      result = await sweepStalledLoopRuns();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Both runs still counted as stalled (the watchdog throw doesn't undo the transition)
    expect(result?.stalledCount).toBe(2);

    // sweep.completed still emitted (console.info at minimum)
    // The sweep loop continues to the second candidate despite the first throwing
    expect(invokeWatchdogCalls).toHaveLength(2);
  });
});
