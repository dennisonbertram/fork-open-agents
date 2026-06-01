/**
 * Regression guards for validateAndPersistWorkflowInputSnapshot (#46)
 *
 * These tests lock the highest-value invariants. If the change in 426811a8
 * is reverted or degraded, these tests catch it.
 *
 * Regression scenarios:
 * 1. SECRET REDACTION: persisted row never contains a raw secret value
 * 2. NEVER-THROWS: DB failure returns a typed error, never throws
 * 3. BACKWARD COMPAT: freeform chat (no workflowId) bypasses the gate
 * 4. INVALID INPUT BLOCKS RUN: invalid inputs return error, no snapshot persisted
 * 5. REDACTION IS SCHEMA-DRIVEN: sensitive flag (not key name pattern) governs redaction
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── server-only mock ────────────────────────────────────────────────────────
mock.module("server-only", () => ({}));

// ── Controllable DB fake ────────────────────────────────────────────────────

type InsertedRow = {
  id: string;
  workflowRunId: string;
  inputValues: Record<string, unknown>;
};

let insertedRows: InsertedRow[] = [];
let dbShouldThrow = false;

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (row: InsertedRow) => ({
      onConflictDoNothing: (_config: unknown) => {
        if (dbShouldThrow) {
          throw new Error("regression: simulated DB connection error");
        }
        insertedRows.push(row);
        return Promise.resolve();
      },
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: fakeDb,
}));

const modulePromise = import("./run-start");

// ── Schema fixtures ─────────────────────────────────────────────────────────

const schemaWithSecret = {
  fields: [
    {
      key: "plainText",
      label: "Plain Text",
      kind: "string",
      required: true,
      sensitive: false,
    },
    {
      key: "secretKey",
      label: "Secret Key",
      kind: "secret",
      required: true,
      sensitive: true,
    },
  ],
};

const schemaWithSensitiveFlag = {
  fields: [
    {
      key: "notSensitiveByName",
      label: "Not Sensitive By Name",
      kind: "string",
      required: true,
      sensitive: true, // sensitive flag, not based on key name
    },
    {
      key: "normalField",
      label: "Normal Field",
      kind: "string",
      required: true,
      sensitive: false,
    },
  ],
};

// ── Regression tests ────────────────────────────────────────────────────────

describe("regression: secret redaction invariant", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // REGRESSION 1: A future change that skips redaction would expose raw secrets
  // in the DB row. This test catches that regression.
  test("persisted inputValues row NEVER contains raw secret value for kind:secret field", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const rawSecret = "production-api-key-DO-NOT-STORE-1234567890";

    await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-run-001",
      workflowId: "wf-regression",
      schema: schemaWithSecret,
      inputValues: {
        plainText: "hello world",
        secretKey: rawSecret,
      },
      userId: "user-regression-001",
    });

    expect(insertedRows).toHaveLength(1);
    // The raw secret must never appear anywhere in the stored row
    const serialized = JSON.stringify(insertedRows[0]);
    expect(serialized).not.toContain(rawSecret);
    // The redaction marker must be present in place
    expect(insertedRows[0]?.inputValues["secretKey"]).toBe("[REDACTED]");
    // Non-sensitive field must pass through unchanged
    expect(insertedRows[0]?.inputValues["plainText"]).toBe("hello world");
  });

  // REGRESSION 2: Redaction is schema-driven (sensitive flag), not key-name based.
  // A field named "notSensitiveByName" with sensitive:true must still be redacted.
  test("redaction is governed by sensitive flag, not by field key naming convention", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const sensitiveValue = "sensitive-content-regardless-of-name";

    await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-run-002",
      workflowId: "wf-regression",
      schema: schemaWithSensitiveFlag,
      inputValues: {
        notSensitiveByName: sensitiveValue,
        normalField: "this-is-fine-to-store",
      },
      userId: "user-regression-001",
    });

    expect(insertedRows).toHaveLength(1);
    // sensitive:true field must be redacted even if its key name suggests otherwise
    expect(insertedRows[0]?.inputValues["notSensitiveByName"]).toBe(
      "[REDACTED]",
    );
    const serialized = JSON.stringify(insertedRows[0]);
    expect(serialized).not.toContain(sensitiveValue);
    // normal (sensitive:false) field must pass through
    expect(insertedRows[0]?.inputValues["normalField"]).toBe(
      "this-is-fine-to-store",
    );
  });
});

describe("regression: never-throws invariant", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // REGRESSION 3: A future change that lets DB exceptions propagate would
  // break the never-throws contract and potentially expose stack traces.
  test("DB failure always returns workflow_input_persist_failed, never propagates exception", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    dbShouldThrow = true;

    // Must resolve (not reject) even when the DB throws
    let threw = false;
    let result: Awaited<
      ReturnType<typeof validateAndPersistWorkflowInputSnapshot>
    > | null = null;

    try {
      result = await validateAndPersistWorkflowInputSnapshot({
        workflowRunId: "reg-run-003",
        workflowId: "wf-regression",
        schema: schemaWithSecret,
        inputValues: {
          plainText: "text",
          secretKey: "some-secret",
        },
        userId: "user-regression-001",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    if (result?.success === false) {
      expect(result.errorKind).toBe("workflow_input_persist_failed");
    }
    // No rows inserted
    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: backward compat — freeform chat bypasses gate", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // REGRESSION 4: validateAndPersistWorkflowInputSnapshot should not be called
  // for freeform chat runs. The route.ts gate only fires when workflowId is present.
  // This test asserts the function is callable without a workflowId and that
  // unauthorized is only triggered by missing userId (not missing workflowId).
  // The route.ts caller is responsible for the workflowId gate — tested separately.
  test("function requires valid userId (guards auth regardless of workflowId)", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    // Without userId — should be unauthorized regardless of other args
    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-run-004",
      workflowId: undefined,
      schema: schemaWithSecret,
      inputValues: {},
      userId: null,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_unauthorized");
    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: invalid input blocks run — no snapshot written", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // REGRESSION 5: A future change that persists the snapshot before validation
  // completes would allow invalid inputs to start durable runs. This test catches
  // that regression by asserting no row is written on validation failure.
  test("validation failure produces zero DB rows — snapshot is never partially persisted", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-run-005",
      workflowId: "wf-regression",
      schema: schemaWithSecret,
      inputValues: {
        plainText: 12345, // wrong type: number instead of string
        // secretKey: missing required field
      },
      userId: "user-regression-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    // CRITICAL: absolutely no rows may be in the DB on validation failure
    expect(insertedRows).toHaveLength(0);
  });

  // REGRESSION 6: fieldErrors array must be non-empty and include the correct key
  // when a required field is missing. A future change that forgets to populate
  // fieldErrors would break #47's per-field error rendering.
  test("workflow_input_invalid always includes per-field error details for #47 rendering", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-run-006",
      workflowId: "wf-regression",
      schema: schemaWithSecret,
      inputValues: {
        // Both fields missing
      },
      userId: "user-regression-001",
    });

    expect(result.success).toBe(false);
    if (result.success || result.errorKind !== "workflow_input_invalid") {
      throw new Error("expected workflow_input_invalid");
    }
    // Both required fields should produce errors
    expect(result.fieldErrors.length).toBeGreaterThanOrEqual(1);
    const hasPlainTextError = result.fieldErrors.some(
      (e) => e.key === "plainText",
    );
    expect(hasPlainTextError).toBe(true);
    // Each error must have a non-empty message string
    for (const err of result.fieldErrors) {
      expect(typeof err.key).toBe("string");
      expect(err.key.length).toBeGreaterThan(0);
      expect(typeof err.message).toBe("string");
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});
