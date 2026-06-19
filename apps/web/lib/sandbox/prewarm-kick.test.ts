/**
 * Unit tests for kickSandboxPrewarmWorkflow.
 *
 * BT-K01: when claim succeeds → prewarmSessionSandbox runs once.
 * BT-K02: when claim fails (returns false) → start NOT called.
 * BT-K03: when prewarm throws → lease is still released.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Spies ─────────────────────────────────────────────────────────────────────

const spies = {
  claimSessionPrewarmRunId: mock(
    async (_sessionId: string, _runId: string) => true,
  ),
  clearSessionPrewarmRunId: mock(
    async (_sessionId: string, _runId: string) => undefined,
  ),
  prewarmSessionSandbox: mock(async () => ({ status: "prewarmed" as const })),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

mock.module("@/lib/db/sessions", () => ({
  claimSessionPrewarmRunId: spies.claimSessionPrewarmRunId,
  clearSessionPrewarmRunId: spies.clearSessionPrewarmRunId,
}));

mock.module("./prewarm", () => ({
  prewarmSessionSandbox: spies.prewarmSessionSandbox,
}));

// ── Import module under test (after all mocks) ─────────────────────────────────

const kickModulePromise = import("./prewarm-kick");

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.values(spies).forEach((spy) => spy.mockClear());
  spies.claimSessionPrewarmRunId.mockImplementation(async () => true);
  spies.prewarmSessionSandbox.mockImplementation(async () => ({
    status: "prewarmed" as const,
  }));
});

describe("kickSandboxPrewarmWorkflow", () => {
  describe("BT-K01: claim succeeds → prewarm runs", () => {
    test("calls prewarmSessionSandbox when claim succeeds", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      expect(scheduledCallbacks).toHaveLength(1);
      await scheduledCallbacks[0]?.();

      expect(spies.claimSessionPrewarmRunId).toHaveBeenCalledTimes(1);
      expect(spies.prewarmSessionSandbox).toHaveBeenCalledTimes(1);
      const prewarmCall = spies.prewarmSessionSandbox.mock
        .calls[0] as unknown as [{ sessionId: string; userId: string }];
      expect(prewarmCall[0]).toEqual({
        sessionId: "session-1",
        userId: "user-1",
      });
      expect(spies.clearSessionPrewarmRunId).toHaveBeenCalledTimes(1);
    });

    test("uses void run() when no scheduleBackgroundWork provided", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      // Fire without scheduler — should not throw
      kickSandboxPrewarmWorkflow({ sessionId: "session-2", userId: "user-2" });

      // Give the microtask queue a moment to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(spies.prewarmSessionSandbox).toHaveBeenCalledTimes(1);
    });
  });

  describe("BT-K02: claim fails → start NOT called", () => {
    test("does not call prewarmSessionSandbox when claimSessionPrewarmRunId returns false", async () => {
      spies.claimSessionPrewarmRunId.mockImplementationOnce(async () => false);

      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      expect(spies.claimSessionPrewarmRunId).toHaveBeenCalledTimes(1);
      expect(spies.prewarmSessionSandbox).not.toHaveBeenCalled();
      expect(spies.clearSessionPrewarmRunId).not.toHaveBeenCalled();
    });
  });

  describe("BT-K03: prewarm throws → lease release", () => {
    test("clears the lease when prewarmSessionSandbox throws", async () => {
      spies.prewarmSessionSandbox.mockImplementationOnce(async () => {
        throw new Error("prewarm failed");
      });

      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      expect(spies.prewarmSessionSandbox).toHaveBeenCalledTimes(1);
      expect(spies.clearSessionPrewarmRunId).toHaveBeenCalledTimes(1);
    });
  });

  // ── Regression tests ───────────────────────────────────────────────────────

  describe("REG-K001: runId format — must start with prewarm: prefix for traceability", () => {
    test("the claimed and cleared runId starts with prewarm:", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      const claimCall = spies.claimSessionPrewarmRunId.mock.calls[0] as [
        string,
        string,
      ];
      const clearCall = spies.clearSessionPrewarmRunId.mock.calls[0] as [
        string,
        string,
      ];
      expect(claimCall[1]).toMatch(/^prewarm:\d+:/);
      expect(clearCall[1]).toBe(claimCall[1]);
    });
  });

  describe("REG-K002: clearSessionPrewarmRunId is called after prewarm", () => {
    test("clearSessionPrewarmRunId is called with the claimed runId", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      expect(spies.clearSessionPrewarmRunId).toHaveBeenCalledTimes(1);
      const claimCall = spies.claimSessionPrewarmRunId.mock.calls[0] as [
        string,
        string,
      ];
      const clearCall = spies.clearSessionPrewarmRunId.mock.calls[0] as [
        string,
        string,
      ];
      expect(clearCall[0]).toBe("session-1");
      expect(clearCall[1]).toBe(claimCall[1]);
    });
  });
});
