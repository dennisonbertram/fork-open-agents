/**
 * Unit tests for kickSandboxPrewarmWorkflow.
 *
 * BT-K01: when claim succeeds → start called once with [sessionId, userId, runId].
 * BT-K02: when claim fails (returns false) → start NOT called.
 * BT-K03: when start() throws → inline fallback calls prewarmSessionSandbox.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Spies ─────────────────────────────────────────────────────────────────────

const spies = {
  start: mock(async () => ({ runId: "workflow-run-1" })),
  claimSessionPrewarmRunId: mock(
    async (_sessionId: string, _runId: string) => true,
  ),
  clearSessionPrewarmRunId: mock(
    async (_sessionId: string, _runId: string) => undefined,
  ),
  prewarmSessionSandbox: mock(async () => ({ status: "prewarmed" as const })),
};

const sandboxPrewarmWorkflow = Symbol("sandboxPrewarmWorkflow");

// ── Module mocks ──────────────────────────────────────────────────────────────

mock.module("workflow/api", () => ({
  start: spies.start,
}));

mock.module("@/app/workflows/sandbox-prewarm", () => ({
  sandboxPrewarmWorkflow,
}));

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
  spies.start.mockImplementation(async () => ({ runId: "workflow-run-1" }));
  spies.prewarmSessionSandbox.mockImplementation(async () => ({
    status: "prewarmed" as const,
  }));
});

describe("kickSandboxPrewarmWorkflow", () => {
  describe("BT-K01: claim succeeds → start called", () => {
    test("calls start with the workflow and [sessionId, userId, runId] when claim succeeds", async () => {
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
      expect(spies.start).toHaveBeenCalledTimes(1);

      const startCalls = spies.start.mock.calls as unknown as Array<
        [unknown, [string, string, string]]
      >;
      const startArgs = startCalls[0];
      expect(startArgs?.[0]).toBe(sandboxPrewarmWorkflow);
      expect(startArgs?.[1]?.[0]).toBe("session-1");
      expect(startArgs?.[1]?.[1]).toBe("user-1");
      // Third arg is the runId — just verify it's a non-empty string
      expect(typeof startArgs?.[1]?.[2]).toBe("string");
      expect(startArgs?.[1]?.[2]).toMatch(/^prewarm:/);
    });

    test("uses void run() when no scheduleBackgroundWork provided", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      // Fire without scheduler — should not throw
      kickSandboxPrewarmWorkflow({ sessionId: "session-2", userId: "user-2" });

      // Give the microtask queue a moment to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(spies.start).toHaveBeenCalledTimes(1);
    });
  });

  describe("BT-K02: claim fails → start NOT called", () => {
    test("does not call start when claimSessionPrewarmRunId returns false", async () => {
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
      expect(spies.start).not.toHaveBeenCalled();
    });
  });

  describe("BT-K03: start throws → inline fallback", () => {
    test("calls prewarmSessionSandbox inline when start() throws", async () => {
      spies.start.mockImplementationOnce(async () => {
        throw new Error("workflow start failed");
      });

      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      expect(spies.start).toHaveBeenCalledTimes(1);
      // Inline fallback runs prewarmSessionSandbox
      expect(spies.prewarmSessionSandbox).toHaveBeenCalledTimes(1);
      const fallbackCall = spies.prewarmSessionSandbox.mock
        .calls[0] as unknown as [{ sessionId: string; userId: string }];
      expect(fallbackCall[0]).toMatchObject({
        sessionId: "session-1",
        userId: "user-1",
      });
    });
  });

  // ── Regression tests ───────────────────────────────────────────────────────

  describe("REG-K001: runId format — must start with prewarm: prefix for traceability", () => {
    test("the runId passed to start() starts with prewarm:", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      const startCalls = spies.start.mock.calls as unknown as Array<
        [unknown, [string, string, string]]
      >;
      const runId = startCalls[0]?.[1]?.[2] ?? "";
      expect(runId).toMatch(/^prewarm:\d+:/);
    });
  });

  describe("REG-K002: workflow is invoked with correct argument order [sessionId, userId, runId]", () => {
    test("start arguments are in the correct order to match sandboxPrewarmWorkflow signature", async () => {
      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "my-session",
        userId: "my-user",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      const startCalls = spies.start.mock.calls as unknown as Array<
        [unknown, [string, string, string]]
      >;
      const args = startCalls[0]?.[1];
      expect(args?.[0]).toBe("my-session"); // sessionId first
      expect(args?.[1]).toBe("my-user"); // userId second
      // runId third — just validate it's a string
      expect(typeof args?.[2]).toBe("string");
    });
  });

  describe("REG-K003: clearSessionPrewarmRunId is called on start() failure", () => {
    test("clearSessionPrewarmRunId is called with the correct runId before the inline fallback", async () => {
      spies.start.mockImplementationOnce(async () => {
        throw new Error("start failed");
      });

      const { kickSandboxPrewarmWorkflow } = await kickModulePromise;

      const scheduledCallbacks: Array<() => Promise<void>> = [];
      kickSandboxPrewarmWorkflow({
        sessionId: "session-1",
        userId: "user-1",
        scheduleBackgroundWork: (cb) => scheduledCallbacks.push(cb),
      });

      await scheduledCallbacks[0]?.();

      // clearSessionPrewarmRunId must have been called
      expect(spies.clearSessionPrewarmRunId).toHaveBeenCalledTimes(1);
      const clearCall = spies.clearSessionPrewarmRunId.mock.calls[0] as [
        string,
        string,
      ];
      expect(clearCall[0]).toBe("session-1");
      // The runId should match the pattern
      expect(clearCall[1]).toMatch(/^prewarm:/);
    });
  });
});
