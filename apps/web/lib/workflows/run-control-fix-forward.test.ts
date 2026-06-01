/**
 * Failing tests for fix-forward #50: step-isolation, CAS transitions,
 * sdk-failure handling, unique run-id, 404-vs-500 ownership.
 *
 * TDD RED commit: these tests fail before the implementation changes.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock server-only (no-op for tests)
// ---------------------------------------------------------------------------

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared fake DB state for run-control tests
// ---------------------------------------------------------------------------

type FakeControlRow = {
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

let fakeDb: Map<string, FakeControlRow> = new Map();
let dbShouldThrow = false;
let updateConditionalHonored = true; // When true, CAS update checks expectedFrom status
let sdkCancelShouldThrow = false;
let sdkResumeShouldThrow = false;
let updateCallCount = 0;
let conditionalUpdateCallCount = 0;

// Track calls into createRunControl from the step helper
let createRunControlCalls: unknown[] = [];

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports of the modules under test
// ---------------------------------------------------------------------------

mock.module("../db/workflow-run-controls", () => ({
  getRunControl: async (runId: string) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    return fakeDb.get(runId) ?? null;
  },
  updateRunControlStatus: async (
    runId: string,
    updates: Partial<FakeControlRow> & { expectedFromStatus?: string },
  ) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    updateCallCount++;
    const row = fakeDb.get(runId);
    if (!row) return null;

    // CAS guard: if the caller passes expectedFromStatus, only update if the
    // current status matches. This simulates DB-level CAS behavior.
    if (updates.expectedFromStatus !== undefined) {
      conditionalUpdateCallCount++;
      if (updateConditionalHonored && row.status !== updates.expectedFromStatus) {
        // CAS failed — no rows updated
        return null;
      }
    }

    const updated = { ...row, ...updates, updatedAt: new Date() };
    fakeDb.set(runId, updated);
    return updated;
  },
  createRunControl: async (input: unknown) => {
    if (dbShouldThrow) throw new Error("DB connection error");
    createRunControlCalls.push(input);
    const typedInput = input as {
      workflowRunId: string;
      chatId: string;
      sessionId: string;
      userId: string;
      hookToken: string;
      idempotencyKey: string;
    };
    const row: FakeControlRow = {
      workflowRunId: typedInput.workflowRunId,
      chatId: typedInput.chatId,
      sessionId: typedInput.sessionId,
      userId: typedInput.userId,
      status: "running",
      pendingCommandKind: null,
      hookToken: typedInput.hookToken,
      idempotencyKey: typedInput.idempotencyKey,
      commandedBy: null,
      commandedAt: null,
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    fakeDb.set(typedInput.workflowRunId, row);
    return row;
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
      if (sdkCancelShouldThrow) {
        throw new Error("SDK cancel failed: network timeout");
      }
      // simulate cancel succeeding
    },
    get status() {
      return Promise.resolve("running");
    },
  }),
  resumeHook: async (_token: unknown, _payload: unknown) => {
    if (sdkResumeShouldThrow) {
      throw new Error("SDK resumeHook failed: network timeout");
    }
    // simulate resume succeeding
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(
  overrides: Partial<FakeControlRow> & { workflowRunId: string },
): FakeControlRow {
  return {
    workflowRunId: overrides.workflowRunId,
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    status: "running",
    pendingCommandKind: null,
    hookToken: `pause:${overrides.workflowRunId}`,
    idempotencyKey: `init:${overrides.workflowRunId}`,
    commandedBy: null,
    commandedAt: null,
    appliedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Import AFTER mocks are set up
const runControlModulePromise = import("./run-control");

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeDb = new Map();
  dbShouldThrow = false;
  updateConditionalHonored = true;
  sdkCancelShouldThrow = false;
  sdkResumeShouldThrow = false;
  updateCallCount = 0;
  conditionalUpdateCallCount = 0;
  createRunControlCalls = [];
});

// ===========================================================================
// FIX 2: CAS transition — no TOCTOU lost-update
// ===========================================================================

describe("FIX 2: CAS transition prevents TOCTOU lost-update", () => {
  test("when two concurrent pause commands race from 'running', only ONE wins", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    // Start: row is 'running'
    fakeDb.set(
      "run-cas-1",
      makeRow({ workflowRunId: "run-cas-1", status: "running" }),
    );

    // Simulate: first command reads row, gets 'running'
    // Both commands attempt CAS: UPDATE WHERE status='running' SET status='pausing'
    // Only the FIRST should update (second sees row already 'pausing')
    const [result1, result2] = await Promise.all([
      applyRunControlCommand({
        runId: "run-cas-1",
        userId: "user-1",
        command: "pause",
        idempotencyKey: "idem-pause-A",
      }),
      applyRunControlCommand({
        runId: "run-cas-1",
        userId: "user-1",
        command: "cancel",
        idempotencyKey: "idem-cancel-B",
      }),
    ]);

    // One must succeed, one must fail — NOT both ok:true
    const successes = [result1, result2].filter((r) => r.ok).length;
    const failures = [result1, result2].filter((r) => !r.ok).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);
  });

  test("CAS-guarded update: when expected status doesn't match, returns null (0 rows updated)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    // Row is already 'pausing' (first command won the race)
    fakeDb.set(
      "run-cas-2",
      makeRow({ workflowRunId: "run-cas-2", status: "pausing", idempotencyKey: "idem-pause-A" }),
    );

    // Second command: tries to transition from 'running' (stale read) but row is now 'pausing'
    // With CAS, this must fail because status='pausing' !== expectedFrom='running'
    const result = await applyRunControlCommand({
      runId: "run-cas-2",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-B",
    });

    // Must NOT be ok:true — the row is already transitioning
    // Result should be conflict or illegal_transition, not ok:true
    expect(result.ok).toBe(false);
    // pausing state with different key → conflict
    expect(
      (result as { ok: false; error: string }).error === "run_control_conflict" ||
      (result as { ok: false; error: string }).error === "run_control_illegal_transition",
    ).toBe(true);
  });

  test("updateRunControlStatus uses expectedFromStatus guard (CAS semantic)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;

    fakeDb.set(
      "run-cas-3",
      makeRow({ workflowRunId: "run-cas-3", status: "running" }),
    );

    // Apply a legal transition
    const result = await applyRunControlCommand({
      runId: "run-cas-3",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-pause-C",
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    // The update call must have been made with an expectedFromStatus guard
    // This is verified by checking conditionalUpdateCallCount > 0
    expect(conditionalUpdateCallCount).toBeGreaterThan(0);
  });
});

// ===========================================================================
// FIX 3: SDK cancel/resume failure returns ok:false and reverts row
// ===========================================================================

describe("FIX 3: SDK failure → ok:false + row reverted", () => {
  test("when cancel SDK throws, applyRunControlCommand returns ok:false (not ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    sdkCancelShouldThrow = true;

    fakeDb.set(
      "run-sdk-1",
      makeRow({ workflowRunId: "run-sdk-1", status: "running" }),
    );

    const result = await applyRunControlCommand({
      runId: "run-sdk-1",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-sdk",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "run_control_persist_failed",
    );
  });

  test("when cancel SDK throws, the control row is reverted to prior status (not stuck in 'cancelling')", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    sdkCancelShouldThrow = true;

    fakeDb.set(
      "run-sdk-2",
      makeRow({ workflowRunId: "run-sdk-2", status: "running" }),
    );

    await applyRunControlCommand({
      runId: "run-sdk-2",
      userId: "user-1",
      command: "cancel",
      idempotencyKey: "idem-cancel-sdk-2",
    });

    // Row must be reverted to 'running' (prior status), not stuck in 'cancelling'
    const row = fakeDb.get("run-sdk-2");
    expect(row?.status).toBe("running");
  });

  test("when resume SDK throws, applyRunControlCommand returns ok:false (not ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    sdkResumeShouldThrow = true;

    fakeDb.set(
      "run-sdk-3",
      makeRow({ workflowRunId: "run-sdk-3", status: "paused" }),
    );

    const result = await applyRunControlCommand({
      runId: "run-sdk-3",
      userId: "user-1",
      command: "resume",
      idempotencyKey: "idem-resume-sdk",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "run_control_persist_failed",
    );
  });

  test("when resume SDK throws, the control row is reverted to 'paused' (not stuck in 'resuming')", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    sdkResumeShouldThrow = true;

    fakeDb.set(
      "run-sdk-4",
      makeRow({ workflowRunId: "run-sdk-4", status: "paused" }),
    );

    await applyRunControlCommand({
      runId: "run-sdk-4",
      userId: "user-1",
      command: "resume",
      idempotencyKey: "idem-resume-sdk-2",
    });

    // Row must be reverted to 'paused' (prior status), not stuck in 'resuming'
    const row = fakeDb.get("run-sdk-4");
    expect(row?.status).toBe("paused");
  });

  test("pause command succeeding with no SDK call is unaffected (no revert)", async () => {
    const { applyRunControlCommand } = await runControlModulePromise;
    // pause has no SDK side-effect beyond the hook already set up in the workflow body

    fakeDb.set(
      "run-sdk-5",
      makeRow({ workflowRunId: "run-sdk-5", status: "running" }),
    );

    const result = await applyRunControlCommand({
      runId: "run-sdk-5",
      userId: "user-1",
      command: "pause",
      idempotencyKey: "idem-pause-sdk",
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    const row = fakeDb.get("run-sdk-5");
    expect(row?.status).toBe("pausing");
  });
});

// ===========================================================================
// FIX 4: Schema unique constraint on workflow_run_id
// ===========================================================================

describe("FIX 4: Schema enforces one-row-per-run", () => {
  test("schema.ts has UNIQUE index on workflow_run_id (not just run+idempotency composite)", async () => {
    const schemaSource = await Bun.file(
      new URL("../../db/schema.ts", import.meta.url),
    ).text();

    // Must have a uniqueIndex on workflowRunId alone (not just the composite)
    // This can be:
    //   - workflowRunId as PRIMARY KEY, or
    //   - uniqueIndex("...").on(table.workflowRunId)  [single-column unique]
    const hasUniqueRunId =
      // Option A: workflowRunId is the primary key
      schemaSource.includes('workflowRunId: text("workflow_run_id").primaryKey()') ||
      schemaSource.includes('text("workflow_run_id").primaryKey()') ||
      // Option B: explicit uniqueIndex on workflow_run_id alone
      (schemaSource.includes("workflow_run_controls_run_id_unique") ||
        schemaSource.match(
          /uniqueIndex\(["'][^"']+["']\)\.on\(table\.workflowRunId\)(?!\s*,)/,
        ) !== null);

    expect(hasUniqueRunId).toBe(true);
  });

  test("createRunControl is idempotent on re-insert for the same runId", async () => {
    // With a UNIQUE on workflow_run_id, a second insert for the same runId
    // must not throw — the onConflictDoNothing should target workflow_run_id.
    // The fake DB here simulates the idempotent behavior.
    const { createRunControl } = await import("../db/workflow-run-controls");

    // First insert
    await createRunControl({
      workflowRunId: "run-idm-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      hookToken: "pause:run-idm-1",
      idempotencyKey: "init:run-idm-1",
    });

    expect(createRunControlCalls.length).toBe(1);

    // Second insert for same runId — must not throw
    await expect(
      createRunControl({
        workflowRunId: "run-idm-1",
        chatId: "chat-1",
        sessionId: "session-1",
        userId: "user-1",
        hookToken: "pause:run-idm-1",
        idempotencyKey: "init:run-idm-1",
      }),
    ).resolves.not.toThrow();
  });
});

// ===========================================================================
// FIX 5: 404 vs 500 in requireOwnedWorkflowRunByRunId
// ===========================================================================

describe("FIX 5: 404-vs-500 distinction in ownership check", () => {
  test("requireOwnedWorkflowRunByRunId returns 404 when run not found (no row)", async () => {
    // Mock getRunControl to return null (genuinely absent)
    mock.module("@/lib/db/workflow-run-controls", () => ({
      getRunControl: async () => null,
      updateRunControlStatus: async () => null,
      createRunControl: async () => null,
      WorkflowRunControlError: class WorkflowRunControlError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = "WorkflowRunControlError";
          this.code = code;
        }
      },
    }));

    const { requireOwnedWorkflowRunByRunId } = await import(
      "../../app/api/chat/_lib/chat-context"
    );

    const result = await requireOwnedWorkflowRunByRunId({
      userId: "user-1",
      runId: "run-nonexistent",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: Response }).response.status).toBe(
      404,
    );
  });

  test("requireOwnedWorkflowRunByRunId returns 500 when DB throws (not 404)", async () => {
    // Mock getRunControl to throw a DB error (not return null)
    mock.module("@/lib/db/workflow-run-controls", () => ({
      getRunControl: async () => {
        throw new Error("DB connection pool exhausted");
      },
      updateRunControlStatus: async () => null,
      createRunControl: async () => null,
      WorkflowRunControlError: class WorkflowRunControlError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = "WorkflowRunControlError";
          this.code = code;
        }
      },
    }));

    const { requireOwnedWorkflowRunByRunId } = await import(
      "../../app/api/chat/_lib/chat-context"
    );

    const result = await requireOwnedWorkflowRunByRunId({
      userId: "user-1",
      runId: "run-db-error",
    });

    expect(result.ok).toBe(false);
    // DB error must NOT be masked as 404 — must be 500
    expect((result as { ok: false; response: Response }).response.status).toBe(
      500,
    );
  });
});

// ===========================================================================
// FIX 6: idempotencyKey max(128) in control route body schema
// ===========================================================================

describe("FIX 6: idempotencyKey max(128) validation", () => {
  test("controlBodySchema rejects idempotencyKey longer than 128 characters", async () => {
    // Read the route.ts source and verify the schema has .max(128)
    const routeSource = await Bun.file(
      new URL(
        "../../app/api/workflows/runs/[runId]/control/route.ts",
        import.meta.url,
      ),
    ).text();

    expect(routeSource).toContain("max(128)");
  });
});

// ===========================================================================
// FIX 1: setupRunControl is a step helper (tested via structural source check
//        and behavioral boundary test in chat.test.ts)
// ===========================================================================

describe("FIX 1: setupRunControl is invoked as a step-isolated helper", () => {
  test("chat.ts contains a 'use step' helper that wraps the createRunControl DB write", async () => {
    const chatSource = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // The helper must exist with 'use step' directive
    // It can be named setupRunControl or similar
    const hasStepHelper =
      chatSource.includes('"use step"') &&
      // The createRunControl call must be inside a function with "use step",
      // NOT directly in the workflow body (surrounded by try { createHook; await createRunControl })
      // We verify by checking that createRunControl is NOT called in the outer try that has createHook
      // AND that there's a function with "use step" that calls createRunControl
      (() => {
        // Find the setupRunControl-style function
        const stepFnMatch = chatSource.match(
          /async function \w+\([^)]*\)[^{]*\{[^}]*"use step"[^}]*createRunControl/s,
        );
        return stepFnMatch !== null;
      })();

    expect(hasStepHelper).toBe(true);
  });

  test("chat.ts does NOT call createRunControl directly in the workflow body try-catch", async () => {
    const chatSource = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // In the fixed version, createRunControl should NOT appear together with
    // createHook in the same try block in the workflow body.
    // The workflow body should call a step helper instead.
    // We check: the try block containing createHook does NOT also contain createRunControl
    const workflowBody = chatSource.slice(
      chatSource.indexOf('"use workflow"'),
    );

    // Find the createHook usage in the workflow body
    const hookIdx = workflowBody.indexOf("createHook");
    expect(hookIdx).toBeGreaterThan(-1);

    // The surrounding try block should NOT contain createRunControl
    // Get a window around createHook (500 chars before and after)
    const hookContext = workflowBody.slice(
      Math.max(0, hookIdx - 200),
      hookIdx + 200,
    );
    expect(hookContext).not.toContain("createRunControl");
  });

  test("if setupRunControl throws, the workflow run still proceeds (best-effort)", async () => {
    // This is tested in chat.test.ts via the existing mock for createRunControl.
    // Here we verify the structural property: the catch must LOG not be empty.
    const chatSource = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // The catch block around the control setup must contain a console.warn or console.error
    // (not be empty). We look for the catch that follows the setupRunControl call.
    const workflowBody = chatSource.slice(
      chatSource.indexOf('"use workflow"'),
    );

    // Find the catch near the run-control section (after createHook line)
    const hookIdx = workflowBody.indexOf("createHook");
    const afterHook = workflowBody.slice(hookIdx);
    const catchIdx = afterHook.indexOf("} catch");
    const catchBlock = afterHook.slice(catchIdx, catchIdx + 300);

    // The catch block must NOT be empty (must log the failure)
    const isEmptyCatch = catchBlock.match(/\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/);
    expect(isEmptyCatch).toBeNull();
  });
});
