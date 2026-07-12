/**
 * Agent Loops — sweep regression tests (M1-10)
 *
 * Catches future breakage of:
 * REG-SW-01: sweep always uses conditional transition (not unconditional)
 * REG-SW-02: race condition — 0-rows-updated path skips event + counts stalled=0
 * REG-SW-03: sweep returns correct counts when all candidates are skipped (race)
 * REG-SW-04: sweep result is typed (stalledCount + checkedCount always present)
 * REG-SW-05: threshold default (15 min) is used when env var absent
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

let recordedEvents: EventInput[] = [];
let recordedConditionalTransitions: ConditionalTransitionInput[] = [];

let conditionalTransitionResult: { id: string; status: string } | null = {
  id: "run-placeholder",
  status: "stalled",
};

let stalledCandidates: Array<{
  id: string;
  status: "queued" | "running";
  lastEventName: string | null;
  lastEventAt: Date;
}> = [];

const findStalledLoopRunCandidates = mock(
  async (_params: { thresholdMinutes: number }) => {
    return stalledCandidates;
  },
);

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

mock.module("@/lib/agent-loops/store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  findStalledLoopRunCandidates,
  conditionallyTransitionRunStatus,
  recordAgentLoopEvent,
  getAgentLoopRunExecutionContext: mock(async () => null),
  updateAgentLoopRunContext: mock(async () => undefined),
  retryCurrentStep: mock(async () => undefined),
  listAgentLoopRuns: mock(async () => []),
}));

// Mock watchdog module — sweep now imports invokeWatchdogForStall
mock.module("@/lib/agent-loops/watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false })),
  invokeWatchdogForStall: mock(async () => ({ invoked: false })),
}));

mock.module("@/lib/agent-loops/config", () => ({
  getAgentLoopsStallMinutes: () => {
    const raw = process.env.AGENT_LOOPS_STALL_MINUTES;
    if (raw) {
      const parsed = parseInt(raw, 10);
      return isNaN(parsed) ? 15 : parsed;
    }
    return 15;
  },
  isAgentLoopsEnabled: mock(() => true),
  isAgentLoopRepoAllowed: mock(() => true),
  getAgentLoopsAllowedRepos: mock(() => []),
}));

const sweepModulePromise = import("./sweep");

function makeCandidate(opts: {
  id: string;
  status: "queued" | "running";
  ageMinutes: number;
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
    lastEventName: "agent-loop.run.started",
    lastEventAt: new Date(now.getTime() - opts.ageMinutes * 60 * 1000),
  };
}

describe("sweep regression tests — breakage detection", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedConditionalTransitions = [];
    stalledCandidates = [];
    findStalledLoopRunCandidates.mockClear();
    conditionallyTransitionRunStatus.mockClear();
    recordAgentLoopEvent.mockClear();
    conditionalTransitionResult = { id: "run-placeholder", status: "stalled" };
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
    delete process.env.AGENT_LOOPS_STALL_MINUTES;
  });

  test("REG-SW-01: sweep ALWAYS uses conditionallyTransitionRunStatus (not updateAgentLoopRunStatus)", async () => {
    // If the implementation reverts to unconditional updateAgentLoopRunStatus,
    // this test fails because conditionallyTransitionRunStatus is never called.
    stalledCandidates = [
      makeCandidate({ id: "run-1", status: "queued", ageMinutes: 20 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    // The conditional version must be used — not the unconditional update
    expect(conditionallyTransitionRunStatus).toHaveBeenCalled();
    // The conditional call must use fromStatuses (the marker of conditional path)
    const call = recordedConditionalTransitions[0];
    expect(call).toBeDefined();
    expect(Array.isArray(call?.fromStatuses)).toBe(true);
    expect(call?.fromStatuses.length).toBeGreaterThan(0);
  });

  test("REG-SW-02: when conditional transition returns null (race), stalled event is NOT emitted", async () => {
    // If the race guard (null-check) is removed, the event would be emitted
    // even when the run was already handled by another path.
    stalledCandidates = [
      makeCandidate({ id: "run-raced", status: "running", ageMinutes: 20 }),
    ];
    // Simulate 0 rows updated — another path got there first
    conditionalTransitionResult = null;

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    const stalledEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.stalled",
    );
    expect(stalledEvents).toHaveLength(0);
  });

  test("REG-SW-03: when all candidates are racily skipped, stalledCount=0, checkedCount=N", async () => {
    stalledCandidates = [
      makeCandidate({ id: "run-a", status: "queued", ageMinutes: 20 }),
      makeCandidate({ id: "run-b", status: "running", ageMinutes: 25 }),
    ];
    // All transitions return null (race condition for both)
    conditionalTransitionResult = null;

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    const result = await sweepStalledLoopRuns();

    expect(result.stalledCount).toBe(0);
    expect(result.checkedCount).toBe(2);
  });

  test("REG-SW-04: result object always has stalledCount and checkedCount as numbers", async () => {
    stalledCandidates = [];

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    const result = await sweepStalledLoopRuns();

    expect(typeof result.stalledCount).toBe("number");
    expect(typeof result.checkedCount).toBe("number");
  });

  test("REG-SW-05: default threshold is 15 minutes when AGENT_LOOPS_STALL_MINUTES unset", async () => {
    delete process.env.AGENT_LOOPS_STALL_MINUTES;
    stalledCandidates = [];

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    expect(findStalledLoopRunCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdMinutes: 15 }),
    );
  });
});
