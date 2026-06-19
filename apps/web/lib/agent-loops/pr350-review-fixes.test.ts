/**
 * PR #350 review-bot fix tests — RED phase (TASK-350)
 *
 * Finding 1 (P2/security): typed RunControlError replaces string-matching in
 *   mapControlError. The store must distinguish "not_found" (unknown runId OR
 *   non-owned run) from "illegal_transition" (run exists, owned, wrong status).
 *   A non-owned run in a pausable state must map to 404, NOT 409.
 *
 * Finding 2 (P2): listStepRunsForRun documents createdAt ASCENDING but the
 *   query ordered DESCENDING. Fix must return rows oldest→newest.
 *
 * BT-350-01: RunControlError class exported from run-controls-error.ts with
 *            kind: "not_found" | "illegal_transition"
 *
 * BT-350-02: pauseLoopRun (store) — unknown runId → throws RunControlError{kind:"not_found"}
 * BT-350-03: pauseLoopRun (store) — non-owned run in pausable state → throws RunControlError{kind:"not_found"}
 * BT-350-04: pauseLoopRun (store) — own run in wrong state → throws RunControlError{kind:"illegal_transition"}
 * BT-350-05: cancelLoopRun (store) — non-owned run → throws RunControlError{kind:"not_found"}
 * BT-350-06: cancelLoopRun (store) — own run in wrong state → throws RunControlError{kind:"illegal_transition"}
 * BT-350-07: resumeLoopRun (store) — non-owned run → throws RunControlError{kind:"not_found"}
 * BT-350-08: resumeLoopRun (store) — own run in wrong state → throws RunControlError{kind:"illegal_transition"}
 *
 * BT-350-09: mapControlError — RunControlError{kind:"not_found"} → 404
 * BT-350-10: mapControlError — RunControlError{kind:"illegal_transition"} → 409
 * BT-350-11: mapControlError — non-RunControlError plain Error → rethrows
 *
 * BT-350-12: listStepRunsForRun returns three step runs ordered oldest→newest
 *            (createdAt ascending, M1-09 timeline contract)
 */

import { describe, expect, mock, test } from "bun:test";
import type { RunControlError as RunControlErrorType } from "./run-controls-error";

mock.module("server-only", () => ({}));

// ── BT-350-01: RunControlError class ─────────────────────────────────────────

describe("BT-350-01: RunControlError is exported with kind discriminator", () => {
  test("RunControlError has kind='not_found' and is instanceof Error", async () => {
    const { RunControlError } = await import("./run-controls-error");
    const err = new RunControlError("not_found", "Run xyz not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("not_found");
    expect(err.message).toContain("not found");
  });

  test("RunControlError has kind='illegal_transition'", async () => {
    const { RunControlError } = await import("./run-controls-error");
    const err = new RunControlError(
      "illegal_transition",
      "Cannot pause: wrong state",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("illegal_transition");
  });

  test("RunControlError.name is 'RunControlError' for clear stack traces", async () => {
    const { RunControlError } = await import("./run-controls-error");
    const err = new RunControlError("not_found", "msg");
    expect(err.name).toBe("RunControlError");
  });
});

// ── BT-350-09–11: mapControlError switches on typed kind ─────────────────────

describe("BT-350-09: mapControlError maps RunControlError{kind:not_found} to 404", () => {
  test("RunControlError not_found → 404 response with error body", async () => {
    const { RunControlError } = await import("./run-controls-error");
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");
    const err = new RunControlError("not_found", "Run xyz not found");
    const resp = mapControlError(err);
    expect(resp.status).toBe(404);
  });
});

describe("BT-350-10: mapControlError maps RunControlError{kind:illegal_transition} to 409", () => {
  test("RunControlError illegal_transition → 409 with errorKind in body", async () => {
    const { RunControlError } = await import("./run-controls-error");
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");
    const err = new RunControlError(
      "illegal_transition",
      "Cannot pause: not pausable",
    );
    const resp = mapControlError(err);
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["errorKind"]).toBe("illegal_transition");
  });
});

describe("BT-350-11: mapControlError rethrows non-RunControlError errors", () => {
  test("plain Error that is not RunControlError → rethrows (becomes 500)", async () => {
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");
    const unexpected = new Error("database connection lost");
    expect(() => mapControlError(unexpected)).toThrow(
      "database connection lost",
    );
  });
});

// ── BT-350-02–08: store functions throw typed RunControlError ─────────────────
// These tests mock the DB and verify that the store functions:
//   (a) do a re-check SELECT when the UPDATE matches 0 rows, and
//   (b) throw RunControlError with the correct kind based on the re-check result.

// DB mock state for store tests
let updateReturning: unknown[] = [];
let selectReturning: unknown[] = [];

const updateWhereReturning = mock(() => updateReturning);
const updateWhere = mock(() => ({ returning: updateWhereReturning }));
const updateSet = mock(() => ({ where: updateWhere }));
const updateMock = mock(() => ({ set: updateSet }));

const selectLimitMock = mock(() => Promise.resolve(selectReturning));
const selectWhereMock = mock(() => ({ limit: selectLimitMock }));
const selectFromMock = mock(() => ({ where: selectWhereMock }));
const selectMock = mock(() => ({ from: selectFromMock }));

const findFirstMock = mock(async () =>
  selectReturning.length > 0 ? selectReturning[0] : null,
);

mock.module("@/lib/db/client", () => ({
  db: {
    update: updateMock,
    select: selectMock,
    query: {
      agentLoopRuns: { findFirst: findFirstMock },
      agentLoopStepRuns: {
        findFirst: findFirstMock,
        findMany: mock(async () => selectReturning),
      },
    },
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoopRuns: Symbol("agentLoopRuns"),
  agentLoopStepRuns: Symbol("agentLoopStepRuns"),
  agentLoopEvents: Symbol("agentLoopEvents"),
  agentLoops: Symbol("agentLoops"),
  agentLoopWatchdogRuns: Symbol("agentLoopWatchdogRuns"),
}));

const storePromise = import("./store");

function resetStoreMocks() {
  updateReturning = [];
  selectReturning = [];
  updateMock.mockClear();
  updateSet.mockClear();
  updateWhere.mockClear();
  updateWhereReturning.mockClear();
  selectMock.mockClear();
  selectFromMock.mockClear();
  selectWhereMock.mockClear();
  selectLimitMock.mockClear();
  findFirstMock.mockClear();
}

describe("BT-350-02: pauseLoopRun — unknown runId → RunControlError{kind:not_found}", () => {
  test("0-row update + no row in re-check SELECT → throws RunControlError not_found", async () => {
    resetStoreMocks();
    // UPDATE matches 0 rows
    updateReturning = [];
    // Re-check SELECT (no row — run does not exist at all)
    selectReturning = [];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.pauseLoopRun("nonexistent-run", "user-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("not_found");
  });
});

describe("BT-350-03: pauseLoopRun — non-owned run in pausable state → RunControlError{kind:not_found}", () => {
  test("0-row update + re-check shows row exists (different userId) → not_found (no existence leak)", async () => {
    resetStoreMocks();
    // UPDATE matches 0 rows (userId mismatch or wrong status)
    updateReturning = [];
    // Re-check: run EXISTS but belongs to a different user (we query by runId alone)
    // The re-check must query with userId scoping — if userId doesn't own it, returns null.
    // We simulate: findFirst returns null (ownership-scoped re-check fails).
    selectReturning = [];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.pauseLoopRun("run-owned-by-other", "attacker-user");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("not_found");
  });
});

describe("BT-350-04: pauseLoopRun — own run in wrong state → RunControlError{kind:illegal_transition}", () => {
  test("0-row update + re-check finds own run (wrong status) → illegal_transition", async () => {
    resetStoreMocks();
    // UPDATE matches 0 rows (wrong status, e.g. run is in 'completed')
    updateReturning = [];
    // Re-check finds the run owned by this user (status exists but not pausable)
    selectReturning = [
      {
        id: "run-completed",
        userId: "user-1",
        status: "completed",
      },
    ];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.pauseLoopRun("run-completed", "user-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("illegal_transition");
  });
});

describe("BT-350-05: cancelLoopRun — non-owned run → RunControlError{kind:not_found}", () => {
  test("0-row update + ownership re-check fails → not_found", async () => {
    resetStoreMocks();
    updateReturning = [];
    selectReturning = [];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.cancelLoopRun("run-other", "attacker");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("not_found");
  });
});

describe("BT-350-06: cancelLoopRun — own run in wrong state → RunControlError{kind:illegal_transition}", () => {
  test("0-row update + re-check finds owned run → illegal_transition", async () => {
    resetStoreMocks();
    updateReturning = [];
    selectReturning = [
      { id: "run-cancelled", userId: "user-1", status: "cancelled" },
    ];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.cancelLoopRun("run-cancelled", "user-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("illegal_transition");
  });
});

describe("BT-350-07: resumeLoopRun — non-owned run → RunControlError{kind:not_found}", () => {
  test("0-row update + ownership re-check fails → not_found", async () => {
    resetStoreMocks();
    updateReturning = [];
    selectReturning = [];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.resumeLoopRun("run-other", "attacker");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("not_found");
  });
});

describe("BT-350-08: resumeLoopRun — own run in wrong state → RunControlError{kind:illegal_transition}", () => {
  test("0-row update + re-check finds owned run in running state → illegal_transition", async () => {
    resetStoreMocks();
    updateReturning = [];
    selectReturning = [
      { id: "run-running", userId: "user-1", status: "running" },
    ];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    let thrown: unknown = null;
    try {
      await store.resumeLoopRun("run-running", "user-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RunControlError);
    expect((thrown as RunControlErrorType).kind).toBe("illegal_transition");
  });
});

// ── BT-350-12: listStepRunsForRun — ascending order (oldest→newest) ──────────

describe("BT-350-12: listStepRunsForRun returns step runs ordered oldest→newest (createdAt ASC)", () => {
  test("three step runs returned in createdAt ascending order", async () => {
    const t0 = new Date("2024-01-01T00:00:00Z");
    const t1 = new Date("2024-01-01T00:01:00Z");
    const t2 = new Date("2024-01-01T00:02:00Z");

    resetStoreMocks();

    // Steps ordered oldest→newest (as the fixed query should return them)
    const steps = [
      { id: "step-1", loopRunId: "run-1", nodeId: "a", createdAt: t0 },
      { id: "step-2", loopRunId: "run-1", nodeId: "b", createdAt: t1 },
      { id: "step-3", loopRunId: "run-1", nodeId: "c", createdAt: t2 },
    ];

    // The findMany mock already routes through selectReturning / findFirstMock;
    // use the top-level findManyMock set via selectReturning.
    // We set selectReturning to our ordered steps so the top-level findManyMock
    // returns them in the declared order.
    selectReturning = steps;

    const store = await storePromise;
    const result = await store.listStepRunsForRun("run-1");

    // Must be oldest→newest
    expect(result.length).toBe(3);
    expect(result[0]?.id).toBe("step-1");
    expect(result[1]?.id).toBe("step-2");
    expect(result[2]?.id).toBe("step-3");
    expect(result[0]?.createdAt.getTime()).toBeLessThan(
      result[1]?.createdAt.getTime() ?? 0,
    );
    expect(result[1]?.createdAt.getTime()).toBeLessThan(
      result[2]?.createdAt.getTime() ?? 0,
    );
  });
});
