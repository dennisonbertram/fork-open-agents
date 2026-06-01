/**
 * Tests for validateAndPersistWorkflowInputSnapshot (#46)
 *
 * TDD — these tests are written BEFORE the implementation.
 * Run with: bun test apps/web/lib/workflows/run-start.test.ts
 *
 * Pattern follows apps/web/lib/db/sessions.test.ts and
 * apps/web/lib/managed-runtime/profile-resolution.test.ts.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── server-only mock (must precede all dynamic imports) ────────────────────
mock.module("server-only", () => ({}));

// ── DB state controlled by tests ───────────────────────────────────────────

type InsertedRow = {
  id: string;
  workflowRunId: string;
  workflowId: string | null;
  schemaVersion: string | null;
  inputValues: Record<string, unknown>;
  persistedAt: Date;
  createdAt: Date;
};

let insertedRows: InsertedRow[] = [];
let dbShouldThrow = false;

const fakeInsert = (row: InsertedRow) => {
  insertedRows.push(row);
};

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (row: InsertedRow) => ({
      onConflictDoNothing: (_config: unknown) => {
        if (dbShouldThrow) {
          throw new Error("simulated DB connection error");
        }
        fakeInsert(row);
        return Promise.resolve();
      },
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: fakeDb,
}));

// ── Module under test (dynamic import after mocks) ─────────────────────────
const modulePromise = import("./run-start");

// ── Helper schema definitions ──────────────────────────────────────────────

/** A valid WorkflowInputSchema with a mix of field kinds */
const validSchema = {
  fields: [
    {
      key: "repoUrl",
      label: "Repository URL",
      kind: "string",
      required: true,
      sensitive: false,
    },
    {
      key: "maxDepth",
      label: "Max Depth",
      kind: "number",
      required: false,
      default: 3,
      sensitive: false,
    },
    {
      key: "apiToken",
      label: "API Token",
      kind: "secret",
      required: true,
      sensitive: true,
    },
    {
      key: "env",
      label: "Environment",
      kind: "enum",
      required: true,
      sensitive: false,
      allowedValues: ["production", "staging"],
    },
  ],
};

const validInputValues = {
  repoUrl: "https://github.com/example/repo",
  maxDepth: 5,
  apiToken: "super-secret-token-12345",
  env: "production",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("validateAndPersistWorkflowInputSnapshot", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // BT-001: valid inputs → success + snapshotId + snapshot persisted
  test("valid inputValues matching WorkflowInputSchema returns success and persists snapshot", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-001",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: validInputValues,
      userId: "user-001",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(typeof result.snapshotId).toBe("string");
    expect(result.snapshotId.length).toBeGreaterThan(0);
    // A snapshot row must be persisted
    expect(insertedRows).toHaveLength(1);
    // The raw secret must NOT appear in the stored row
    expect(insertedRows[0]?.inputValues["apiToken"]).toBe("[REDACTED]");
    expect(insertedRows[0]?.inputValues["apiToken"]).not.toBe(
      "super-secret-token-12345",
    );
    // Non-sensitive fields are stored as-is
    expect(insertedRows[0]?.inputValues["repoUrl"]).toBe(
      "https://github.com/example/repo",
    );
    expect(insertedRows[0]?.workflowRunId).toBe("run-001");
  });

  // BT-002: missing required field → workflow_input_invalid + fieldErrors + no persist
  test("missing required field returns workflow_input_invalid, no run started, no snapshot persisted", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-002",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      // omit required "repoUrl"
      inputValues: {
        maxDepth: 2,
        apiToken: "some-token",
        env: "staging",
      },
      userId: "user-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    // fieldErrors must be an array with at least one entry for the missing field
    expect(Array.isArray(result.fieldErrors)).toBe(true);
    expect(result.fieldErrors.length).toBeGreaterThan(0);
    const repoUrlError = result.fieldErrors.find(
      (e: { key: string; message: string }) => e.key === "repoUrl",
    );
    expect(repoUrlError).toBeDefined();
    expect(typeof repoUrlError?.message).toBe("string");
    // No snapshot row written
    expect(insertedRows).toHaveLength(0);
  });

  // BT-003: wrong field type → workflow_input_invalid + fieldErrors + no persist
  test("wrong field type returns workflow_input_invalid, no run started", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-003",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: {
        repoUrl: "https://github.com/example/repo",
        maxDepth: "not-a-number", // wrong type: string instead of number
        apiToken: "token",
        env: "production",
      },
      userId: "user-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(Array.isArray(result.fieldErrors)).toBe(true);
    expect(result.fieldErrors.length).toBeGreaterThan(0);
    const maxDepthError = result.fieldErrors.find(
      (e: { key: string; message: string }) => e.key === "maxDepth",
    );
    expect(maxDepthError).toBeDefined();
    // No snapshot row written
    expect(insertedRows).toHaveLength(0);
  });

  // BT-004: enum value not in allowedValues → workflow_input_invalid
  test("enum value not in allowedValues returns workflow_input_invalid", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-004",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: {
        repoUrl: "https://github.com/example/repo",
        maxDepth: 2,
        apiToken: "token",
        env: "development", // not in ["production", "staging"]
      },
      userId: "user-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(Array.isArray(result.fieldErrors)).toBe(true);
    const envError = result.fieldErrors.find(
      (e: { key: string; message: string }) => e.key === "env",
    );
    expect(envError).toBeDefined();
    expect(insertedRows).toHaveLength(0);
  });

  // BT-005: unauthorized caller → workflow_input_unauthorized
  test("unauthorized caller returns workflow_input_unauthorized", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-005",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: validInputValues,
      userId: null, // no userId = unauthorized
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_unauthorized");
    // No snapshot row written
    expect(insertedRows).toHaveLength(0);
  });

  // BT-006: DB write failure → workflow_input_persist_failed (NEVER throws)
  test("DB write failure returns workflow_input_persist_failed and does not throw", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    dbShouldThrow = true;

    const resultPromise = validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-006",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: validInputValues,
      userId: "user-001",
    });

    // Must not throw — must return a typed error
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_persist_failed");
    // No successfully inserted rows
    expect(insertedRows).toHaveLength(0);
  });

  // BT-007: secret field stored as "[REDACTED]" — not the raw value
  test("sensitive field (kind: secret) is stored as [REDACTED] in snapshot", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const secretValue = "my-very-secret-api-key-xyz";

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-007",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      inputValues: {
        repoUrl: "https://github.com/example/repo",
        maxDepth: 1,
        apiToken: secretValue,
        env: "staging",
      },
      userId: "user-001",
    });

    expect(result.success).toBe(true);
    expect(insertedRows).toHaveLength(1);
    // Critical: stored value must be the literal "[REDACTED]"
    expect(insertedRows[0]?.inputValues["apiToken"]).toBe("[REDACTED]");
    // Critical: raw secret must NOT appear in the stored row
    const storedJson = JSON.stringify(insertedRows[0]?.inputValues);
    expect(storedJson).not.toContain(secretValue);
  });

  // BT-008: sensitive: true (non-secret kind) field is also redacted
  test("non-secret field with sensitive: true is also stored as [REDACTED]", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const schemaWithSensitiveString = {
      fields: [
        {
          key: "personalNote",
          label: "Personal Note",
          kind: "string",
          required: true,
          sensitive: true,
        },
      ],
    };

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-008",
      workflowId: "wf-sensitive-fields",
      schema: schemaWithSensitiveString,
      inputValues: {
        personalNote: "my private notes here",
      },
      userId: "user-001",
    });

    expect(result.success).toBe(true);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.inputValues["personalNote"]).toBe("[REDACTED]");
    expect(insertedRows[0]?.inputValues["personalNote"]).not.toBe(
      "my private notes here",
    );
  });

  // BT-009 (stub/deferred): workflow_version_mismatch — requires #29/#30 catalog
  // Deferred: the catalog lookup is not yet available (#29/#30 unmerged).
  // This test is skipped with documentation for future implementer.
  test.skip("stale schemaVersion returns workflow_version_mismatch (deferred — #29/#30 not landed)", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    // When #29/#30 lands, the catalog lookup will verify that the submitted
    // schemaVersion matches the catalog's current version for workflowId.
    // The result should be:
    // { success: false, errorKind: "workflow_version_mismatch",
    //   currentVersion: "<catalog version>", submittedVersion: "<submitted>" }
    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-009",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      schemaVersion: "v0.1-stale",
      inputValues: validInputValues,
      userId: "user-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_version_mismatch");
  });

  // BT-010: no workflowId → freeform path, helper should handle gracefully
  // (the route.ts caller checks for workflowId presence before calling, but
  //  the function itself is defined to require workflowRunId+schema; this test
  //  ensures the route-level backward compat is documented at the unit level)
  test("all field errors are collected before returning (collect all errors, not fail-fast)", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "run-010",
      workflowId: "wf-repo-analysis",
      schema: validSchema,
      // Multiple invalid fields: wrong type for maxDepth AND bad enum value
      inputValues: {
        repoUrl: "https://github.com/example/repo",
        maxDepth: "wrong-type",
        apiToken: "token",
        env: "invalid-env-value",
      },
      userId: "user-001",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(result.fieldErrors.length).toBeGreaterThanOrEqual(2);
    expect(insertedRows).toHaveLength(0);
  });
});

describe("WorkflowRunStartErrorKind", () => {
  test("exports the WorkflowRunStartErrorKind type (compile-time check via runtime import)", async () => {
    const mod = await modulePromise;
    // The function must exist and be callable
    expect(typeof mod.validateAndPersistWorkflowInputSnapshot).toBe("function");
    // WorkflowInputSnapshotError class must be exported
    expect(typeof mod.WorkflowInputSnapshotError).toBe("function");
  });
});
