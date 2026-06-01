/**
 * Regression tests for #50 fix-forward: concurrency, idempotency, durable-seam,
 * backward-compat, and schema invariant guards.
 *
 * These tests would fail if the changes in 7b3534c0 are reverted:
 * - CAS transition guard in applyRunControlCommand
 * - SDK-failure revert (cancel/resume returns ok:false + row reverts)
 * - setupRunControl step isolation (structural source check)
 * - workflow_run_id unique constraint (schema source check)
 * - 404-vs-500 DB error distinction in requireOwnedWorkflowRunByRunId
 * - idempotencyKey max(128) in control route
 * - Backward-compat: no-control-row runs still denied with 404 (not crash)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Fake DB for regression tests
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

let regressionDb = new Map<string, FakeControlRow>();
let sdkCancelThrows = false;
let sdkResumeThrows = false;
let conditionalUpdateCount = 0;

mock.module("../db/workflow-run-controls", () => ({
  getRunControl: async (runId: string) => regressionDb.get(runId) ?? null,
  updateRunControlStatus: async (
    runId: string,
    updates: Partial<FakeControlRow> & { expectedFromStatus?: string },
  ) => {
    const row = regressionDb.get(runId);
    if (!row) return null;
    if (updates.expectedFromStatus !== undefined) {
      conditionalUpdateCount++;
      if (row.status !== updates.expectedFromStatus) {
        // CAS guard failed — simulate 0 rows updated
        return null;
      }
    }
    const updated = { ...row, ...updates, updatedAt: new Date() };
    regressionDb.set(runId, updated);
    return updated;
  },
  createRunControl: async (input: unknown) => {
    const t = input as { workflowRunId: string; [key: string]: unknown };
    const row: FakeControlRow = {
      workflowRunId: t.workflowRunId,
      chatId: String(t.chatId ?? "chat-1"),
      sessionId: String(t.sessionId ?? "session-1"),
      userId: String(t.userId ?? "user-1"),
      status: "running",
      pendingCommandKind: null,
      hookToken: String(t.hookToken ?? `pause:${t.workflowRunId}`),
      idempotencyKey: String(t.idempotencyKey ?? "init"),
      commandedBy: null,
      commandedAt: null,
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    regressionDb.set(t.workflowRunId, row);
    return row;
  },
  WorkflowRunControlError: Error,
}));

mock.module("workflow/api", () => ({
  getRun: (_runId: string) => ({
    cancel: async () => {
      if (sdkCancelThrows) throw new Error("SDK cancel network error");
    },
  }),
  resumeHook: async (_token: unknown, _payload: unknown) => {
    if (sdkResumeThrows) throw new Error("SDK resume network error");
  },
}));

function makeRegressionRow(
  workflowRunId: string,
  overrides: Partial<FakeControlRow> = {},
): FakeControlRow {
  const defaults: FakeControlRow = {
    workflowRunId,
    chatId: "chat-reg",
    sessionId: "session-reg",
    userId: "user-reg",
    status: "running",
    pendingCommandKind: null,
    hookToken: `pause:${workflowRunId}`,
    idempotencyKey: `init:${workflowRunId}`,
    commandedBy: null,
    commandedAt: null,
    appliedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
  return { ...defaults, ...overrides };
}

const runControlModule = import("./run-control");

beforeEach(() => {
  regressionDb = new Map();
  sdkCancelThrows = false;
  sdkResumeThrows = false;
  conditionalUpdateCount = 0;
});

// ===========================================================================
// Regression: CAS prevents concurrent double-write
// ===========================================================================

describe("regression: CAS prevents concurrent TOCTOU double-write", () => {
  test("two concurrent commands from 'running': exactly ONE wins (not both ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    regressionDb.set("reg-cas-1", makeRegressionRow("reg-cas-1"));

    const [r1, r2] = await Promise.all([
      applyRunControlCommand({
        runId: "reg-cas-1",
        userId: "user-reg",
        command: "pause",
        idempotencyKey: "key-A",
      }),
      applyRunControlCommand({
        runId: "reg-cas-1",
        userId: "user-reg",
        command: "cancel",
        idempotencyKey: "key-B",
      }),
    ]);

    const wins = [r1, r2].filter((r) => r.ok).length;
    expect(wins).toBe(1); // EXACTLY one transition wins
  });

  test("CAS-guarded update is always used (conditionalUpdateCount > 0 per transition)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    regressionDb.set("reg-cas-2", makeRegressionRow("reg-cas-2"));

    await applyRunControlCommand({
      runId: "reg-cas-2",
      userId: "user-reg",
      command: "pause",
      idempotencyKey: "key-C",
    });

    expect(conditionalUpdateCount).toBeGreaterThan(0);
  });

  test("when CAS guard fails (row moved concurrently), result is conflict or illegal-transition (not ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    // Pre-set the row as already 'pausing' — simulates concurrent winner
    regressionDb.set(
      "reg-cas-3",
      makeRegressionRow("reg-cas-3", {
        status: "pausing",
        idempotencyKey: "key-winner",
      }),
    );

    const result = await applyRunControlCommand({
      runId: "reg-cas-3",
      userId: "user-reg",
      command: "cancel",
      idempotencyKey: "key-D",
    });

    expect(result.ok).toBe(false);
    const errKind = (result as { ok: false; error: string }).error;
    expect(
      errKind === "run_control_conflict" ||
        errKind === "run_control_illegal_transition",
    ).toBe(true);
  });
});

// ===========================================================================
// Regression: SDK cancel failure → ok:false + row reverted
// ===========================================================================

describe("regression: SDK cancel failure reverts row and returns ok:false", () => {
  test("cancel SDK throw → ok:false (not ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    sdkCancelThrows = true;
    regressionDb.set("reg-sdk-c1", makeRegressionRow("reg-sdk-c1"));

    const result = await applyRunControlCommand({
      runId: "reg-sdk-c1",
      userId: "user-reg",
      command: "cancel",
      idempotencyKey: "key-sdk-c",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "run_control_persist_failed",
    );
  });

  test("cancel SDK throw → row NOT stuck in 'cancelling' (reverted to prior state)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    sdkCancelThrows = true;
    regressionDb.set("reg-sdk-c2", makeRegressionRow("reg-sdk-c2"));

    await applyRunControlCommand({
      runId: "reg-sdk-c2",
      userId: "user-reg",
      command: "cancel",
      idempotencyKey: "key-sdk-c2",
    });

    expect(regressionDb.get("reg-sdk-c2")?.status).toBe("running");
  });
});

// ===========================================================================
// Regression: SDK resume failure → ok:false + row reverted
// ===========================================================================

describe("regression: SDK resume failure reverts row and returns ok:false", () => {
  test("resume SDK throw → ok:false (not ok:true)", async () => {
    const { applyRunControlCommand } = await runControlModule;
    sdkResumeThrows = true;
    regressionDb.set(
      "reg-sdk-r1",
      makeRegressionRow("reg-sdk-r1", { status: "paused" }),
    );

    const result = await applyRunControlCommand({
      runId: "reg-sdk-r1",
      userId: "user-reg",
      command: "resume",
      idempotencyKey: "key-sdk-r",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "run_control_persist_failed",
    );
  });

  test("resume SDK throw → row NOT stuck in 'resuming' (reverted to 'paused')", async () => {
    const { applyRunControlCommand } = await runControlModule;
    sdkResumeThrows = true;
    regressionDb.set(
      "reg-sdk-r2",
      makeRegressionRow("reg-sdk-r2", { status: "paused" }),
    );

    await applyRunControlCommand({
      runId: "reg-sdk-r2",
      userId: "user-reg",
      command: "resume",
      idempotencyKey: "key-sdk-r2",
    });

    expect(regressionDb.get("reg-sdk-r2")?.status).toBe("paused");
  });
});

// ===========================================================================
// Regression: backward-compat — no-control-row runs get 404 (not crash)
// ===========================================================================

describe("regression: backward-compat — no control row yields 404 not 500/crash", () => {
  test("applyRunControlCommand returns run_control_not_found when no row exists", async () => {
    const { applyRunControlCommand } = await runControlModule;
    // Ensure no row for this runId

    const result = await applyRunControlCommand({
      runId: "run-no-row",
      userId: "user-reg",
      command: "pause",
      idempotencyKey: "key-no-row",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "run_control_not_found",
    );
  });
});

// ===========================================================================
// Regression: structural source checks (would fail if changes are reverted)
// ===========================================================================

describe("regression: structural source invariants", () => {
  test("chat.ts setupRunControl is a 'use step' async function that calls createRunControl", async () => {
    const src = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // Must have a use-step function wrapping createRunControl
    const match = src.match(
      /async function \w+\([\s\S]*?\)[\s\S]*?\{[\s\S]*?"use step"[\s\S]*?createRunControl/,
    );
    expect(match).not.toBeNull();
  });

  test("chat.ts workflow body does NOT call createRunControl directly (it's in the step helper)", async () => {
    const src = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // Extract the workflow body (after "use workflow")
    const workflowBodyIdx = src.indexOf('"use workflow"');
    expect(workflowBodyIdx).toBeGreaterThan(-1);
    const workflowBody = src.slice(workflowBodyIdx);

    // Find createHook call
    const hookIdx = workflowBody.indexOf("createHook");
    expect(hookIdx).toBeGreaterThan(-1);

    // The 200 chars around createHook must NOT also contain createRunControl
    const hookContext = workflowBody.slice(
      Math.max(0, hookIdx - 200),
      hookIdx + 200,
    );
    expect(hookContext).not.toContain("createRunControl");
  });

  test("chat.ts catch block after setupRunControl call logs the failure (not empty catch)", async () => {
    const src = await Bun.file(
      new URL("../../app/workflows/chat.ts", import.meta.url),
    ).text();

    // Find setupRunControl in the workflow body
    const workflowBody = src.slice(src.indexOf('"use workflow"'));
    const helperCallIdx = workflowBody.indexOf("setupRunControl");
    expect(helperCallIdx).toBeGreaterThan(-1);

    // The catch after setupRunControl must have console.warn or console.error
    const afterHelper = workflowBody.slice(helperCallIdx);
    const catchIdx = afterHelper.indexOf("} catch");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = afterHelper.slice(catchIdx, catchIdx + 400);

    // Must contain a logging call — not be an empty catch
    expect(
      catchBlock.includes("console.warn") ||
        catchBlock.includes("console.error"),
    ).toBe(true);
  });

  test("schema.ts has unique index on workflow_run_id alone (one-row-per-run)", async () => {
    const src = await Bun.file(
      new URL("../db/schema.ts", import.meta.url),
    ).text();

    // The uniqueIndex on workflowRunId alone must be present
    expect(src).toContain("workflow_run_controls_run_id_unique");
  });

  test("workflow-run-controls.ts updateRunControlStatus accepts and uses expectedFromStatus", async () => {
    const src = await Bun.file(
      new URL("../db/workflow-run-controls.ts", import.meta.url),
    ).text();

    expect(src).toContain("expectedFromStatus");
  });

  test("control route idempotencyKey has max(128) cap", async () => {
    const src = await Bun.file(
      new URL(
        "../../app/api/workflows/runs/[runId]/control/route.ts",
        import.meta.url,
      ),
    ).text();

    expect(src).toContain("max(128)");
  });

  test("chat-context.ts does NOT use .catch(() => null) to swallow DB errors", async () => {
    const src = await Bun.file(
      new URL("../../app/api/chat/_lib/chat-context.ts", import.meta.url),
    ).text();

    // The blanket-catch pattern should be gone
    expect(src).not.toContain(".catch(() => null)");
  });

  test("run-control.ts uses expectedFromStatus in the CAS update call", async () => {
    const src = await Bun.file(
      new URL("run-control.ts", import.meta.url),
    ).text();

    expect(src).toContain("expectedFromStatus: currentState");
  });
});

// ===========================================================================
// Regression: idempotent re-issue still works with CAS
// ===========================================================================

describe("regression: idempotent re-issue is unaffected by CAS changes", () => {
  test("same command + same key when already in transitional state = no-op (ok:true, no DB write)", async () => {
    const { applyRunControlCommand } = await runControlModule;

    // Row is already 'pausing' with this exact key
    regressionDb.set(
      "reg-idem-1",
      makeRegressionRow("reg-idem-1", {
        status: "pausing",
        idempotencyKey: "key-pause-dup",
      }),
    );
    const updatesBefore = conditionalUpdateCount;

    const result = await applyRunControlCommand({
      runId: "reg-idem-1",
      userId: "user-reg",
      command: "pause",
      idempotencyKey: "key-pause-dup",
    });

    expect(result).toEqual({ ok: true, state: "pausing" });
    // No DB update should have occurred — idempotent no-op returns before CAS
    expect(conditionalUpdateCount).toBe(updatesBefore);
  });
});
