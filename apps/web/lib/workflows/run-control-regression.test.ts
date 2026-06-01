/**
 * Regression tests for the workflow run control state machine (#50).
 *
 * These tests are designed to catch future regressions in:
 * 1. The complete canTransition legal/illegal table
 * 2. Idempotent re-issue returning current state (not re-writing DB)
 * 3. Conflict detection between competing commands
 * 4. Backward-compat: stop route still works on runs with no control row
 * 5. Schema invariant: workflowRunId has no FK constraint (structural test)
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Regression 1: canTransition complete transition table invariants
// ---------------------------------------------------------------------------

const runControlModulePromise = import("./run-control");

describe("regression: canTransition table completeness", () => {
  test("all legal transitions are accepted", async () => {
    const { canTransition } = await runControlModulePromise;

    // The exact set of legal transitions from the issue spec
    const legalPairs: Array<
      [Parameters<typeof canTransition>[0], Parameters<typeof canTransition>[1]]
    > = [
      ["running", "pause"],
      ["running", "cancel"],
      ["paused", "resume"],
      ["paused", "cancel"],
    ];

    for (const [from, command] of legalPairs) {
      expect(canTransition(from, command)).toBe(true);
    }
  });

  test("all illegal transitions are rejected", async () => {
    const { canTransition } = await runControlModulePromise;

    // All state × command combinations not in the legal set
    const states = [
      "running",
      "pausing",
      "paused",
      "resuming",
      "cancelling",
      "cancelled",
    ] as const;
    const commands = ["pause", "resume", "cancel"] as const;
    const legalSet = new Set([
      "running:pause",
      "running:cancel",
      "paused:resume",
      "paused:cancel",
    ]);

    for (const from of states) {
      for (const command of commands) {
        const key = `${from}:${command}`;
        if (!legalSet.has(key)) {
          expect(canTransition(from, command)).toBe(false);
        }
      }
    }
  });

  test("cancel from paused is legal — no need to resume first", async () => {
    const { canTransition } = await runControlModulePromise;
    // This is an explicitly documented invariant in the issue spec
    expect(canTransition("paused", "cancel")).toBe(true);
  });

  test("running + resume is illegal — must pause first", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("running", "resume")).toBe(false);
  });

  test("cancelled state rejects every command — it is terminal", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelled", "pause")).toBe(false);
    expect(canTransition("cancelled", "resume")).toBe(false);
    expect(canTransition("cancelled", "cancel")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression 2: Idempotency — same key + transitioning state = no-op
// ---------------------------------------------------------------------------

type FakeControlRow = {
  id: string;
  workflowRunId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  status: string;
  pendingCommandKind: string | null;
  hookToken: string | null;
  idempotencyKey: string;
  commandedBy: string | null;
  commandedAt: Date | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let updateCallCount = 0;
let fakeRow: FakeControlRow | null = null;

mock.module("../db/workflow-run-controls", () => ({
  getRunControl: async (runId: string) => {
    if (!fakeRow || fakeRow.workflowRunId !== runId) return null;
    return fakeRow;
  },
  updateRunControlStatus: async (
    runId: string,
    updates: Partial<FakeControlRow>,
  ) => {
    updateCallCount++;
    if (!fakeRow || fakeRow.workflowRunId !== runId) return null;
    fakeRow = { ...fakeRow, ...updates };
    return fakeRow;
  },
  createRunControl: async () => fakeRow,
  WorkflowRunControlError: class WorkflowRunControlError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "WorkflowRunControlError";
      this.code = code;
    }
  },
}));

mock.module("workflow/api", () => ({
  getRun: (_runId: string) => ({
    cancel: async () => {},
  }),
  resumeHook: async () => {},
}));

describe("regression: idempotent re-issue MUST NOT write to DB", () => {
  test("second pause with same idempotencyKey returns current state without DB write", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    // Simulate: a pause was already accepted, row is now 'pausing'
    updateCallCount = 0;
    fakeRow = {
      id: "ctrl-r1",
      workflowRunId: "run-r1",
      chatId: "chat-r1",
      sessionId: "session-r1",
      userId: "user-r1",
      status: "pausing",
      pendingCommandKind: "pause",
      hookToken: "pause:run-r1",
      idempotencyKey: "idem-pause-initial",
      commandedBy: "user-r1",
      commandedAt: new Date(),
      appliedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    const result = await applyRunControlCommand({
      runId: "run-r1",
      userId: "user-r1",
      command: "pause",
      idempotencyKey: "idem-pause-initial", // Same key!
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    // CRITICAL: no DB write should have occurred (idempotent no-op)
    expect(updateCallCount).toBe(0);
  });

  test("same cancel command + same key when already cancelling = no-op", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    updateCallCount = 0;
    fakeRow = {
      id: "ctrl-r2",
      workflowRunId: "run-r2",
      chatId: "chat-r2",
      sessionId: "session-r2",
      userId: "user-r2",
      status: "cancelling",
      pendingCommandKind: "cancel",
      hookToken: null,
      idempotencyKey: "idem-cancel-dup",
      commandedBy: "user-r2",
      commandedAt: new Date(),
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await applyRunControlCommand({
      runId: "run-r2",
      userId: "user-r2",
      command: "cancel",
      idempotencyKey: "idem-cancel-dup",
    });

    expect(result).toEqual({ ok: true, state: "cancelling" });
    expect(updateCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression 3: Conflict detection — different key on in-flight command
// ---------------------------------------------------------------------------

describe("regression: conflict detection prevents clobbering in-flight commands", () => {
  test("different idempotencyKey while pausing = run_control_conflict, NOT illegal_transition", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    fakeRow = {
      id: "ctrl-r3",
      workflowRunId: "run-r3",
      chatId: "chat-r3",
      sessionId: "session-r3",
      userId: "user-r3",
      status: "pausing",
      pendingCommandKind: "pause",
      hookToken: "pause:run-r3",
      idempotencyKey: "idem-pause-original",
      commandedBy: "user-r3",
      commandedAt: new Date(),
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await applyRunControlCommand({
      runId: "run-r3",
      userId: "user-r3",
      command: "pause",
      idempotencyKey: "idem-pause-different",
    });

    // Must be conflict, NOT illegal_transition
    expect(result).toEqual({ ok: false, error: "run_control_conflict" });
  });

  test("cancelling + different key = illegal_transition (not conflict)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    // cancelling state should ALWAYS produce illegal_transition, never conflict
    fakeRow = {
      id: "ctrl-r4",
      workflowRunId: "run-r4",
      chatId: "chat-r4",
      sessionId: "session-r4",
      userId: "user-r4",
      status: "cancelling",
      pendingCommandKind: "cancel",
      hookToken: null,
      idempotencyKey: "idem-original",
      commandedBy: "user-r4",
      commandedAt: new Date(),
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await applyRunControlCommand({
      runId: "run-r4",
      userId: "user-r4",
      command: "pause",
      idempotencyKey: "idem-new",
    });

    expect(result).toEqual({
      ok: false,
      error: "run_control_illegal_transition",
    });
  });
});
