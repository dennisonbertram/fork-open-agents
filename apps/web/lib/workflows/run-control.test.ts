import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock server-only so it does not block test imports
mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Fake DB state shared across all tests
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

let fakeControlRow: FakeControlRow | null = null;
let dbShouldThrow = false;
let resumeHookCalls: unknown[] = [];
let cancelCalls: string[] = [];

mock.module("../db/workflow-run-controls", () => ({
  getRunControl: async (runId: string) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    if (!fakeControlRow || fakeControlRow.workflowRunId !== runId) return null;
    return fakeControlRow;
  },
  updateRunControlStatus: async (
    runId: string,
    updates: Partial<FakeControlRow>,
  ) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    if (!fakeControlRow || fakeControlRow.workflowRunId !== runId) return null;
    fakeControlRow = { ...fakeControlRow, ...updates };
    return fakeControlRow;
  },
  createRunControl: async (_input: unknown) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    return fakeControlRow;
  },
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
  getRun: (runId: string) => ({
    cancel: async () => {
      cancelCalls.push(runId);
    },
  }),
  resumeHook: async (token: unknown, payload: unknown) => {
    resumeHookCalls.push({ token, payload });
  },
}));

// Import AFTER mocks are set up
const runControlModulePromise = import("./run-control");

// ---------------------------------------------------------------------------
// Helper to make a fresh control row
// ---------------------------------------------------------------------------
function makeControlRow(
  overrides: Partial<FakeControlRow> = {},
): FakeControlRow {
  return {
    id: "ctrl-1",
    workflowRunId: "run-1",
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    status: "running",
    pendingCommandKind: null,
    hookToken: "pause:run-1",
    idempotencyKey: "idem-init",
    commandedBy: null,
    commandedAt: null,
    appliedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit: canTransition
// ---------------------------------------------------------------------------
describe("canTransition", () => {
  test("running + pause → true (legal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("running", "pause")).toBe(true);
  });

  test("paused + resume → true (legal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("paused", "resume")).toBe(true);
  });

  test("running + cancel → true (legal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("running", "cancel")).toBe(true);
  });

  test("paused + cancel → true (cancel from paused is legal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("paused", "cancel")).toBe(true);
  });

  test("cancelled + pause → false (illegal: terminal state)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelled", "pause")).toBe(false);
  });

  test("cancelled + resume → false (illegal: terminal state)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelled", "resume")).toBe(false);
  });

  test("cancelled + cancel → false (illegal: terminal state)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelled", "cancel")).toBe(false);
  });

  test("cancelling + pause → false (illegal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelling", "pause")).toBe(false);
  });

  test("cancelling + resume → false (illegal)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("cancelling", "resume")).toBe(false);
  });

  test("pausing + cancel → false (illegal when transitioning)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("pausing", "cancel")).toBe(false);
  });

  test("resuming + pause → false (illegal when transitioning)", async () => {
    const { canTransition } = await runControlModulePromise;
    expect(canTransition("resuming", "pause")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: applyRunControlCommand
// ---------------------------------------------------------------------------
describe("applyRunControlCommand", () => {
  beforeEach(() => {
    dbShouldThrow = false;
    resumeHookCalls = [];
    cancelCalls = [];
    fakeControlRow = makeControlRow();
  });

  test("running → pausing: pause command accepted, returns pausing state", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-pause-1",
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    expect(fakeControlRow?.status).toBe("pausing");
  });

  test("paused → resuming: resume command accepted, returns resuming state", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    fakeControlRow = makeControlRow({ status: "paused" });

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "resume",
      idempotencyKey: "idem-resume-1",
    });

    expect(result).toEqual({ ok: true, state: "resuming" });
    expect(fakeControlRow?.status).toBe("resuming");
    expect(resumeHookCalls.length).toBe(1);
    expect((resumeHookCalls[0] as { payload: unknown }).payload).toEqual({
      command: "resume",
    });
  });

  test("running → cancelling: cancel command accepted, returns cancelling state", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-1",
    });

    expect(result).toEqual({ ok: true, state: "cancelling" });
    expect(fakeControlRow?.status).toBe("cancelling");
    expect(cancelCalls).toContain("run-1");
  });

  test("paused → cancelling: cancel from paused is legal (no need to resume first)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    fakeControlRow = makeControlRow({ status: "paused" });

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-2",
    });

    expect(result).toEqual({ ok: true, state: "cancelling" });
    expect(fakeControlRow?.status).toBe("cancelling");
    expect(cancelCalls).toContain("run-1");
  });

  test("cancelled → any: illegal transition returns run_control_illegal_transition", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    fakeControlRow = makeControlRow({ status: "cancelled" });

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-illegal-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "run_control_illegal_transition",
    });
  });

  test("cancelling → pause: illegal transition", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    fakeControlRow = makeControlRow({ status: "cancelling" });

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-illegal-2",
    });

    expect(result).toEqual({
      ok: false,
      error: "run_control_illegal_transition",
    });
  });

  test("same command + same idempotencyKey: idempotent no-op returns current state", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    // Pre-set the control row as if a pause was already issued with this exact key
    fakeControlRow = makeControlRow({
      status: "pausing",
      pendingCommandKind: "pause",
      idempotencyKey: "idem-pause-dup",
    });

    // Track update calls - if idempotent, should NOT call updateRunControlStatus
    const updateCallsBefore = fakeControlRow.updatedAt;

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-pause-dup",
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    // updatedAt should NOT have changed (no DB write)
    expect(fakeControlRow.updatedAt).toEqual(updateCallsBefore);
  });

  test("conflicting pending command (different idempotencyKey): returns run_control_conflict", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    // A pause is already pending with a different key
    fakeControlRow = makeControlRow({
      status: "pausing",
      pendingCommandKind: "pause",
      idempotencyKey: "idem-pause-existing",
    });

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-new",
    });

    expect(result).toEqual({ ok: false, error: "run_control_conflict" });
  });

  test("unauthorized caller: returns run_control_unauthorized", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    // Control row belongs to user-1, but caller is user-999

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-999",
      command: "pause",
      idempotencyKey: "idem-unauth-1",
    });

    expect(result).toEqual({ ok: false, error: "run_control_unauthorized" });
  });

  test("unknown run (no control row): returns run_control_not_found", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    fakeControlRow = null;

    const result = await applyRunControlCommand({
      runId: "run-nonexistent",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-notfound-1",
    });

    expect(result).toEqual({ ok: false, error: "run_control_not_found" });
  });

  test("DB write failure: returns run_control_persist_failed", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    dbShouldThrow = true;

    const result = await applyRunControlCommand({
      runId: "run-1",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-dbfail-1",
    });

    expect(result).toEqual({ ok: false, error: "run_control_persist_failed" });
  });
});
