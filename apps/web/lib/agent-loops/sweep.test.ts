/**
 * Agent Loops — sweep.ts tests (M1-10)
 *
 * TDD matrix for sweepStalledLoopRuns:
 *
 * BT-SW01: past-threshold active (queued) run is marked stalled
 * BT-SW02: past-threshold active (running) run is marked stalled
 * BT-SW03: fresh active run (below threshold) is NOT stalled
 * BT-SW04: paused run is NOT stalled (paused ≠ active for sweep purposes)
 * BT-SW05: terminal runs (completed/failed/cancelled/stalled) are ignored
 * BT-SW06: threshold config is respected (AGENT_LOOPS_STALL_MINUTES)
 * BT-SW07: agent-loop.run.stalled warn event is emitted with correct payload
 * BT-SW08: agent-loop.sweep.completed info event emitted once per sweep with counts
 * BT-SW09: already-stalled run is not re-stalled (idempotent)
 * BT-SW10: sweep returns correct stalled/checked counts
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

// Controls what conditionallyTransitionRunStatus returns:
// non-null = transition succeeded; null = 0 rows (race condition)
let conditionalTransitionResult: { id: string; status: string } | null = {
  id: "run-placeholder",
  status: "stalled",
};

// ── Store mock state ──────────────────────────────────────────────────────────

// Rows returned by findStalledLoopRunCandidates
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

mock.module("@/lib/agent-loops/store", () => ({
  findStalledLoopRunCandidates,
  conditionallyTransitionRunStatus,
  recordAgentLoopEvent,
  updateAgentLoopRunContext: mock(async () => undefined),
  retryCurrentStep: mock(async () => undefined),
  listAgentLoopRuns: mock(async () => []),
}));

// Mock config module — AGENT_LOOPS_STALL_MINUTES controlled via env
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
    lastEventName: opts.lastEventName ?? "agent-loop.run.started",
    lastEventAt: new Date(now.getTime() - opts.ageMinutes * 60 * 1000),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sweepStalledLoopRuns", () => {
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

  test("BT-SW01: past-threshold queued run is marked stalled", async () => {
    // A queued run with last event 20 minutes ago (threshold=15) must be stalled.
    stalledCandidates = [
      makeCandidate({ id: "run-queued-1", status: "queued", ageMinutes: 20 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const stalledTransition = recordedConditionalTransitions.find(
      (u) => u.runId === "run-queued-1" && u.toStatus === "stalled",
    );
    expect(stalledTransition).toBeDefined();
    expect(stalledTransition?.toStatus).toBe("stalled");
    // fromStatuses must be queued/running (conditional — excludes paused/terminal)
    expect(stalledTransition?.fromStatuses).toContain("queued");
    expect(stalledTransition?.fromStatuses).toContain("running");
  });

  test("BT-SW02: past-threshold running run is marked stalled", async () => {
    stalledCandidates = [
      makeCandidate({ id: "run-running-1", status: "running", ageMinutes: 30 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const stalledTransition = recordedConditionalTransitions.find(
      (u) => u.runId === "run-running-1" && u.toStatus === "stalled",
    );
    expect(stalledTransition).toBeDefined();
  });

  test("BT-SW03: fresh active run (below threshold) is NOT stalled", async () => {
    // findStalledLoopRunCandidates already filters by age — if it returns nothing,
    // no run should be stalled.
    stalledCandidates = [];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const stalledTransitions = recordedConditionalTransitions.filter(
      (u) => u.toStatus === "stalled",
    );
    expect(stalledTransitions).toHaveLength(0);
  });

  test("BT-SW04: paused run is NOT a candidate (store excludes it)", async () => {
    // The store function only returns queued/running candidates.
    // This test verifies the sweep does not independently stall paused runs.
    stalledCandidates = []; // store returns nothing for paused runs
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    // findStalledLoopRunCandidates should be called — and paused runs must not
    // appear in any stall transition.
    expect(findStalledLoopRunCandidates).toHaveBeenCalled();
    const stalledTransitions = recordedConditionalTransitions.filter(
      (u) => u.toStatus === "stalled",
    );
    expect(stalledTransitions).toHaveLength(0);
  });

  test("BT-SW05: terminal runs are ignored", async () => {
    // Store only returns active (queued/running) candidates — terminal runs
    // are excluded by the store query.  No stall transitions should occur.
    stalledCandidates = [];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const stalledTransitions = recordedConditionalTransitions.filter(
      (u) => u.toStatus === "stalled",
    );
    expect(stalledTransitions).toHaveLength(0);
  });

  test("BT-SW06: threshold config is respected (AGENT_LOOPS_STALL_MINUTES)", async () => {
    // The store query receives the threshold minutes from config.
    // We verify that findStalledLoopRunCandidates is called with the correct minutes.
    process.env.AGENT_LOOPS_STALL_MINUTES = "5";
    stalledCandidates = [];

    const { sweepStalledLoopRuns } = await sweepModulePromise;
    await sweepStalledLoopRuns();

    // The store function must have been called with threshold of 5 minutes
    expect(findStalledLoopRunCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdMinutes: 5 }),
    );
  });

  test("BT-SW07: agent-loop.run.stalled warn event emitted with correct payload", async () => {
    stalledCandidates = [
      makeCandidate({
        id: "run-stalled-ev",
        status: "running",
        ageMinutes: 20,
        lastEventName: "agent-loop.step.started",
      }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const stalledEvent = recordedEvents.find(
      (e) =>
        e.eventName === "agent-loop.run.stalled" &&
        e.loopRunId === "run-stalled-ev",
    );
    expect(stalledEvent).toBeDefined();
    expect(stalledEvent?.level).toBe("warn");
    expect(stalledEvent?.status).toBe("info");

    // Payload must include loopRunId, lastEventName, lastEventAgeMs
    const payload = stalledEvent?.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload?.loopRunId).toBe("run-stalled-ev");
    expect(payload?.lastEventName).toBe("agent-loop.step.started");
    expect(typeof payload?.lastEventAgeMs).toBe("number");
    expect(payload?.lastEventAgeMs as number).toBeGreaterThan(0);
  });

  test("BT-SW08: agent-loop.sweep.completed info event emitted once per sweep with counts", async () => {
    stalledCandidates = [
      makeCandidate({ id: "run-A", status: "queued", ageMinutes: 20 }),
      makeCandidate({ id: "run-B", status: "running", ageMinutes: 25 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    const sweepCompletedEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.sweep.completed",
    );
    expect(sweepCompletedEvents).toHaveLength(1);

    const sweepEvent = sweepCompletedEvents[0];
    expect(sweepEvent?.level).toBe("info");
    const payload = sweepEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.stalledCount).toBe(2);
    expect(typeof payload?.checkedCount).toBe("number");
    expect(payload?.checkedCount as number).toBeGreaterThanOrEqual(2);
  });

  test("BT-SW09: idempotent — already-stalled run not re-stalled when store returns no candidates", async () => {
    // After a run is stalled, the store query won't return it again (it's terminal).
    // Verify a second sweep call doesn't attempt to stall it again.
    stalledCandidates = [
      makeCandidate({ id: "run-once", status: "queued", ageMinutes: 20 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    await sweepStalledLoopRuns();

    // Second sweep: store now returns nothing (run already stalled)
    stalledCandidates = [];
    findStalledLoopRunCandidates.mockImplementation(async () => []);
    recordedConditionalTransitions = [];

    await sweepStalledLoopRuns();

    const stalledTransitions = recordedConditionalTransitions.filter(
      (u) => u.toStatus === "stalled",
    );
    expect(stalledTransitions).toHaveLength(0);
  });

  test("BT-SW10: sweep returns correct stalled/checked counts", async () => {
    stalledCandidates = [
      makeCandidate({ id: "run-1", status: "queued", ageMinutes: 20 }),
      makeCandidate({ id: "run-2", status: "running", ageMinutes: 30 }),
    ];
    const { sweepStalledLoopRuns } = await sweepModulePromise;

    const result = await sweepStalledLoopRuns();

    expect(result.stalledCount).toBe(2);
    expect(result.checkedCount).toBe(2);
  });
});
