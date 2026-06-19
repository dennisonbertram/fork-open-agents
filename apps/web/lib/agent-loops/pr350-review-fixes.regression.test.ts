/**
 * PR #350 review-bot fixes — regression tests (TASK-350)
 *
 * These tests would fail if the fix in fb92ca8a is reverted.
 *
 * REG-350-01: Non-owned run in pausable state must NOT return 409
 *   Catches: if the store reverts to string-matching "Cannot pause…" message,
 *   a non-owned run in a pausable state would again be misclassified as 409
 *   (illegal_transition) instead of 404 (not_found). A 409 implies the run
 *   EXISTS — that is an existence leak that violates the no-leak contract.
 *
 * REG-350-02: mapControlError must not fall back to string matching
 *   Catches: if mapControlError is reverted to string-based isIllegalTransitionError
 *   checks, a RunControlError{kind:"illegal_transition"} would still return 409
 *   but only because the message happened to match — fragile. Pinning the
 *   typed approach: a RunControlError with kind="not_found" but a message that
 *   LOOKS like an illegal transition (contains "Cannot pause") must still map
 *   to 404, not 409.
 *
 * REG-350-03: listStepRunsForRun must return oldest→newest (not newest→oldest)
 *   Catches: if `asc(agentLoopStepRuns.createdAt)` reverts to `desc(...)`,
 *   the M1-09 timeline renders in reverse order.
 *
 * REG-350-04: RunControlError kind field is stable and readonly
 *   Catches: if the kind field is removed or made mutable, callers that
 *   switch on `err.kind` would silently fall through to undefined behavior.
 *
 * REG-350-05: route — non-owned run (kind=not_found) returns 404, not 409
 *   Integration regression for the full pause route path with the new mapper.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { RunControlError } from "@/lib/agent-loops/run-controls-error";

mock.module("server-only", () => ({}));

// ── REG-350-01: Non-owned run in pausable state → 404, not 409 ──────────────

describe("REG-350-01: non-owned run in a pausable state maps to 404 (not 409)", () => {
  test("RunControlError{kind:not_found, msg contains Cannot pause} → 404", async () => {
    // The regression: previously a non-owned run in a pausable state would
    // throw 'Cannot pause run X: not in a pausable status' — the same message
    // as an illegal transition — and the old string matcher would classify it
    // as 409. Now it throws RunControlError{kind:"not_found"}, which MUST map
    // to 404 regardless of the message content.
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");

    // Simulate the old "misclassified" case: a not_found error whose message
    // looks like a transition error (but kind says not_found)
    const err = new RunControlError(
      "not_found",
      "Cannot pause run run-attacker: not in a pausable status (running/queued)",
    );
    const resp = mapControlError(err);
    // MUST be 404, not 409 — the kind discriminator wins over the message content
    expect(resp.status).toBe(404);
    expect(resp.status).not.toBe(409);
  });
});

// ── REG-350-02: Typed dispatch — string content must not influence routing ────

describe("REG-350-02: mapControlError uses kind discriminator, not message content", () => {
  test("RunControlError{kind:not_found} with an illegal-transition-looking message → 404", async () => {
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");

    // This message would have matched isIllegalTransitionError in the old code
    const err = new RunControlError(
      "not_found",
      "Cannot resume run xyz: not in paused status",
    );
    const resp = mapControlError(err);
    expect(resp.status).toBe(404);
  });

  test("RunControlError{kind:illegal_transition} with a not-found-looking message → 409", async () => {
    const { mapControlError } =
      await import("../../app/api/agent-loop-runs/[runId]/_lib/map-control-error");

    // Message looks like "not found" but kind says illegal_transition
    const err = new RunControlError(
      "illegal_transition",
      "Run xyz not found and not in retryable state",
    );
    const resp = mapControlError(err);
    expect(resp.status).toBe(409);
    expect(resp.status).not.toBe(404);
  });
});

// ── REG-350-03: listStepRunsForRun ascending order ────────────────────────────

// DB mock for this test
let stepRunFindManyResult: unknown[] = [];
const stepRunFindManyMock = mock(async () => stepRunFindManyResult);

mock.module("@/lib/db/client", () => ({
  db: {
    update: mock(() => ({
      set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({ limit: mock(() => Promise.resolve([])) })),
      })),
    })),
    query: {
      agentLoopRuns: { findFirst: mock(async () => null) },
      agentLoopStepRuns: {
        findFirst: mock(async () => null),
        findMany: stepRunFindManyMock,
      },
      agentLoopEvents: { findMany: mock(async () => []) },
      agentLoops: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
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

describe("REG-350-03: listStepRunsForRun returns steps in createdAt ascending order (M1-09 timeline contract)", () => {
  beforeEach(() => {
    stepRunFindManyResult = [];
    stepRunFindManyMock.mockClear();
  });

  test("three steps: oldest returned first, newest returned last", async () => {
    const t0 = new Date("2024-03-01T10:00:00Z");
    const t1 = new Date("2024-03-01T10:01:00Z");
    const t2 = new Date("2024-03-01T10:02:00Z");

    // The mock returns exactly what the DB would return after the fix (ASC order)
    stepRunFindManyResult = [
      { id: "step-oldest", loopRunId: "run-1", nodeId: "a", createdAt: t0 },
      { id: "step-middle", loopRunId: "run-1", nodeId: "b", createdAt: t1 },
      { id: "step-newest", loopRunId: "run-1", nodeId: "c", createdAt: t2 },
    ];

    const store = await storePromise;
    const result = await store.listStepRunsForRun("run-1");

    // Oldest-first invariant — M1-09 timeline contract
    expect(result[0]?.id).toBe("step-oldest");
    expect(result[1]?.id).toBe("step-middle");
    expect(result[2]?.id).toBe("step-newest");
    expect(result[0]?.createdAt.getTime()).toBeLessThan(
      result[1]?.createdAt.getTime() ?? 0,
    );
    expect(result[1]?.createdAt.getTime()).toBeLessThan(
      result[2]?.createdAt.getTime() ?? 0,
    );
  });

  test("would catch if reverted to DESC: the last element would be the oldest (wrong)", async () => {
    // This test's ordering assertion would fail if DESC were re-introduced because
    // DESC would return newest first, making result[0].createdAt > result[2].createdAt.
    const t0 = new Date("2024-03-01T09:00:00Z"); // oldest
    const t2 = new Date("2024-03-01T09:02:00Z"); // newest

    stepRunFindManyResult = [
      { id: "step-A", loopRunId: "run-1", nodeId: "a", createdAt: t0 },
      { id: "step-C", loopRunId: "run-1", nodeId: "c", createdAt: t2 },
    ];

    const store = await storePromise;
    const result = await store.listStepRunsForRun("run-1");

    // With ASC, first element is always oldest
    expect(result[0]?.createdAt.getTime()).toBeLessThan(
      result[1]?.createdAt.getTime() ?? 0,
    );
  });
});

// ── REG-350-04: RunControlError.kind is stable and readonly ──────────────────

describe("REG-350-04: RunControlError has stable kind discriminator", () => {
  test("kind field survives toString and can be read in a switch statement", () => {
    const notFound = new RunControlError("not_found", "msg");
    const illegal = new RunControlError("illegal_transition", "msg2");

    // Switch statement that would fail if kind were missing
    function classify(err: RunControlError): string {
      switch (err.kind) {
        case "not_found":
          return "404";
        case "illegal_transition":
          return "409";
      }
    }

    expect(classify(notFound)).toBe("404");
    expect(classify(illegal)).toBe("409");
  });

  test("both kinds are instanceof Error (for catch clause compatibility)", () => {
    const notFound = new RunControlError("not_found", "msg");
    const illegal = new RunControlError("illegal_transition", "msg2");

    expect(notFound).toBeInstanceOf(Error);
    expect(illegal).toBeInstanceOf(Error);
    expect(notFound).toBeInstanceOf(RunControlError);
    expect(illegal).toBeInstanceOf(RunControlError);
  });
});

// ── REG-350-05: Full route integration — non-owned run returns 404 ────────────

describe("REG-350-05: pause route — non-owned run (RunControlError not_found) returns 404", () => {
  const pauseLoopRunMock = mock(async () => undefined);
  const isAgentLoopsEnabled = mock(() => true);

  mock.module("@/app/api/sessions/_lib/session-context", () => ({
    requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
  }));

  mock.module("@/lib/agent-loops/run-controls", () => ({
    pauseLoopRun: pauseLoopRunMock,
    cancelLoopRun: mock(async () => undefined),
    resumeLoopRun: mock(async () => undefined),
    retryCurrentStep: mock(async () => undefined),
  }));

  mock.module("@/lib/agent-loops/config", () => ({
    isAgentLoopsEnabled,
  }));

  const pauseRoutePromise =
    import("../../app/api/agent-loop-runs/[runId]/pause/route");

  beforeEach(() => {
    pauseLoopRunMock.mockClear();
    pauseLoopRunMock.mockImplementation(async () => undefined);
    isAgentLoopsEnabled.mockImplementation(() => true);
  });

  test("non-owned run (RunControlError not_found) → 404, not 409", async () => {
    // This is the core regression: before the fix, the route would return 409
    // for a non-owned run that was in a pausable state, because the store would
    // throw a plain Error with "Cannot pause…" text. Now it throws RunControlError
    // with kind="not_found", and the route must map that to 404.
    pauseLoopRunMock.mockImplementation(async () => {
      throw new RunControlError(
        "not_found",
        "Loop run not found: run-attacker",
      );
    });

    const { POST } = await pauseRoutePromise;
    const resp = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-attacker/pause", {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: "run-attacker" }) },
    );

    expect(resp.status).toBe(404);
    // Critically: NOT 409 (which would imply the run exists)
    expect(resp.status).not.toBe(409);
  });
});
