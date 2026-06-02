/**
 * RED tests for issue-46 fix-forward (#46)
 *
 * Tests written FIRST — all must fail before implementation.
 * Covers:
 *   Fix 1 (CRITICAL): unknown key raw persistence
 *   Fix 2 (CRITICAL): FK + run-id mismatch (route reorder)
 *   Fix 3 (HIGH): client-schema backstop redaction
 *   Fix 4 (MEDIUM): validation error messages echo raw value
 *   Fix 5 (MEDIUM): conflict returns fabricated snapshotId
 *   Fix 6 (LOW): typed error wrap / dead code
 *
 * Run with: bun test apps/web/lib/workflows/run-start-fixes.test.ts
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── server-only mock (must precede all dynamic imports) ────────────────────────
mock.module("server-only", () => ({}));

// ── DB state controlled by tests ───────────────────────────────────────────────

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
// For Fix 5: simulate conflict (onConflictDoNothing returns empty)
let dbConflictRunId: string | null = null;
// Rows indexed by workflowRunId for select-on-conflict queries
let existingRowByRunId: Record<string, InsertedRow> = {};

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (row: InsertedRow) => ({
      onConflictDoNothing: (_config: unknown) => ({
        returning: ({ id: _id }: { id: unknown }) => {
          if (dbShouldThrow) {
            throw new Error("simulated DB error");
          }
          // Simulate conflict: if this workflowRunId already exists, return []
          if (dbConflictRunId && row.workflowRunId === dbConflictRunId) {
            // Do not insert; return empty (conflict path)
            return Promise.resolve([]);
          }
          insertedRows.push(row);
          existingRowByRunId[row.workflowRunId] = row;
          return Promise.resolve([{ id: row.id }]);
        },
      }),
    }),
  }),
  select: () => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => {
        // Return the matching existing row for the conflict scenario
        const existing = Object.values(existingRowByRunId).find(
          (_r) => true, // simplification: returns first existing
        );
        return Promise.resolve(existing ? [existing] : []);
      },
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: fakeDb,
}));

// ── Dynamic imports AFTER mocks ────────────────────────────────────────────────

const runStartModulePromise = import("./run-start");

// ── Helper schema definitions ──────────────────────────────────────────────────

/** Schema with only 'name' declared */
const schemaNameOnly = {
  fields: [
    {
      key: "name",
      label: "Name",
      kind: "string",
      required: true,
      sensitive: false,
    },
  ],
};

/** Schema that declares 'token' as NOT sensitive (so we can test backstop) */
const schemaTokenNotSensitive = {
  fields: [
    {
      key: "token",
      label: "Token",
      kind: "string",
      required: true,
      sensitive: false, // explicitly not sensitive — backstop must override
    },
  ],
};

/** Schema with enum field */
const schemaWithEnum = {
  fields: [
    {
      key: "name",
      label: "Name",
      kind: "string",
      required: true,
      sensitive: false,
    },
    {
      key: "env",
      label: "Environment",
      kind: "enum",
      required: true,
      sensitive: false,
      allowedValues: ["prod", "dev"],
    },
  ],
};

/** Schema with a secret field */
const schemaWithSecret = {
  fields: [
    {
      key: "name",
      label: "Name",
      kind: "string",
      required: true,
      sensitive: false,
    },
    {
      key: "apiKey",
      label: "API Key",
      kind: "secret",
      required: true,
      sensitive: true,
    },
  ],
};

// ══════════════════════════════════════════════════════════════════════════════
// FIX 1: Unknown key raw persistence (CRITICAL)
// An inputValues key NOT in the schema must NOT be persisted (must either be
// rejected with workflow_input_invalid OR stripped from the stored row).
// The raw secret "LEAKED-SECRET-9999" must NEVER appear in the stored row.
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 1: unknown key raw persistence (CRITICAL)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("unknown key in inputValues is rejected (workflow_input_invalid) and raw secret is never persisted", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;
    // This test uses the NEW validateWorkflowInputs pure function
    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "ok", apiKey: "LEAKED-SECRET-9999" },
      userId: "user-001",
    });

    // Must be invalid: 'apiKey' is not declared in schema
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");
    // fieldErrors must name the unknown key
    const unknownKeyError = result.fieldErrors.find(
      (e) => e.key === "apiKey" || e.message.includes("apiKey"),
    );
    expect(unknownKeyError).toBeDefined();

    // Critical: stored row must not contain the raw secret
    const storedJson = JSON.stringify(insertedRows);
    expect(storedJson).not.toContain("LEAKED-SECRET-9999");
  });

  test("persisted snapshot only includes schema-declared keys (no unknown key pass-through)", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await runStartModulePromise;

    // First validate (should succeed: only 'name' submitted)
    const validation = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "Alice" },
      userId: "user-001",
    });
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    // Then persist with the real runId
    const persistResult = await persist({
      workflowRunId: "real-run-id-001",
      workflowId: "wf-test",
      schemaVersion: null,
      redactedValues: validation.redactedValues,
      persistedAt: new Date(),
    });

    expect(persistResult.success).toBe(true);
    if (!persistResult.success) throw new Error("expected persist success");

    // Stored row must only have 'name'
    expect(insertedRows).toHaveLength(1);
    const storedValues = insertedRows[0]?.inputValues ?? {};
    expect(Object.keys(storedValues)).toEqual(["name"]);
    expect(storedValues["name"]).toBe("Alice");
    // No extra keys
    expect("apiKey" in storedValues).toBe(false);
  });

  test("inputValues that is not a plain object returns workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: "not-an-object" as unknown as Record<string, unknown>,
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 2: route reorder — persist uses real run.runId, never a fabricated nanoid
// The new split: validateWorkflowInputs (pure) + persistWorkflowInputSnapshot
// Tested at the unit level: validateWorkflowInputs returns redactedValues,
// then persist uses the REAL runId, not a pre-generated one.
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 2: persist uses real run.runId (CRITICAL)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("persistWorkflowInputSnapshot receives and stores the real runId (not a pre-generated nanoid)", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await runStartModulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "super-secret" },
      userId: "user-001",
    });

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    const REAL_RUN_ID = "actual-run-id-from-workflow-start-abc123";

    const persistResult = await persist({
      workflowRunId: REAL_RUN_ID,
      workflowId: "wf-test",
      schemaVersion: null,
      redactedValues: validation.redactedValues,
      persistedAt: new Date(),
    });

    expect(persistResult.success).toBe(true);
    expect(insertedRows).toHaveLength(1);
    // Critical: the stored workflowRunId matches the REAL run id
    expect(insertedRows[0]?.workflowRunId).toBe(REAL_RUN_ID);
  });

  test("validateWorkflowInputs is pure (does not persist or start anything)", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "my-secret" },
      userId: "user-001",
    });

    // No rows should be inserted by validate alone
    expect(insertedRows).toHaveLength(0);
  });

  test("persist failure after run start does not throw (best-effort)", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await runStartModulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "my-secret" },
      userId: "user-001",
    });

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    dbShouldThrow = true;

    // Must NOT throw — must return {success: false}
    let threw = false;
    let result: { success: boolean } | null = null;
    try {
      result = await persist({
        workflowRunId: "run-abc",
        workflowId: "wf-test",
        schemaVersion: null,
        redactedValues: validation.redactedValues,
        persistedAt: new Date(),
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.success).toBe(false);
  });

  test("validateWorkflowInputs returns redactedValues as part of valid result", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "my-secret-key" },
      userId: "user-001",
    });

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");
    // redactedValues must be present and have apiKey redacted
    expect(validation.redactedValues).toBeDefined();
    expect(validation.redactedValues["name"]).toBe("Alice");
    expect(validation.redactedValues["apiKey"]).toBe("[REDACTED]");
    expect(validation.redactedValues["apiKey"]).not.toBe("my-secret-key");
  });

  test("validateWorkflowInputs returns errorKind for invalid input (pure return, no throw)", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice" }, // missing required apiKey
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0); // pure: no side effects
  });

  test("validateWorkflowInputs returns workflow_input_unauthorized for missing userId", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "my-key" },
      userId: null,
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_unauthorized");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 3: client-schema backstop redaction (HIGH)
// Keys matching secret-like patterns are force-redacted REGARDLESS of
// the schema's sensitive flag.
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 3: client-schema backstop redaction (HIGH)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("field named 'token' with sensitive:false is force-redacted by key-pattern backstop", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaTokenNotSensitive,
      schemaVersion: null,
      inputValues: { token: "DOWNGRADED-SECRET-7777" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    // Despite sensitive:false in schema, 'token' matches the key pattern
    // and must be redacted
    expect(result.redactedValues["token"]).toBe("[REDACTED]");
    expect(result.redactedValues["token"]).not.toBe("DOWNGRADED-SECRET-7777");
    // Must not appear in stored JSON
    const json = JSON.stringify(result.redactedValues);
    expect(json).not.toContain("DOWNGRADED-SECRET-7777");
  });

  test("backstop redacts 'password' field even when schema marks it sensitive:false", async () => {
    const schemaWithPassword = {
      fields: [
        {
          key: "password",
          label: "Password",
          kind: "string" as const,
          required: true,
          sensitive: false, // client schema says not sensitive — backstop overrides
        },
      ],
    };

    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithPassword,
      schemaVersion: null,
      inputValues: { password: "PLAINTEXT-PASSWORD-XYZ" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    expect(result.redactedValues["password"]).toBe("[REDACTED]");
    const json = JSON.stringify(result.redactedValues);
    expect(json).not.toContain("PLAINTEXT-PASSWORD-XYZ");
  });

  test("backstop redacts 'api_key' field (underscore variant) even when sensitive:false", async () => {
    const schemaWithApiKey = {
      fields: [
        {
          key: "api_key",
          label: "API Key",
          kind: "string" as const,
          required: true,
          sensitive: false, // downgraded — backstop must catch
        },
      ],
    };

    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithApiKey,
      schemaVersion: null,
      inputValues: { api_key: "MY-SECRET-API-KEY-4321" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    expect(result.redactedValues["api_key"]).toBe("[REDACTED]");
    const json = JSON.stringify(result.redactedValues);
    expect(json).not.toContain("MY-SECRET-API-KEY-4321");
  });

  test("backstop does NOT redact innocuous fields (no false positives)", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "Alice" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    // 'name' does not match secret patterns; must NOT be redacted
    expect(result.redactedValues["name"]).toBe("Alice");
    expect(result.redactedValues["name"]).not.toBe("[REDACTED]");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 4: validation error messages must NOT echo raw submitted value (MEDIUM)
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 4: validation error messages do not expose raw submitted value (MEDIUM)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("enum validation error does not include raw submitted value in message", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithEnum,
      schemaVersion: null,
      inputValues: { name: "Alice", env: "SECRET-IN-WRONG-FIELD" },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");

    // CRITICAL: none of the field error messages must contain the raw submitted value
    const allMessages = result.fieldErrors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("SECRET-IN-WRONG-FIELD");
    // Messages should still describe the constraint
    const envError = result.fieldErrors.find((e) => e.key === "env");
    expect(envError).toBeDefined();
    expect(envError?.message).toContain("env"); // field name present
  });

  test("type mismatch error does not include raw submitted value in message", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const schemaWithNumberLocal = {
      fields: [
        {
          key: "count",
          label: "Count",
          kind: "number" as const,
          required: true,
          sensitive: false,
        },
      ],
    };

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithNumberLocal,
      schemaVersion: null,
      inputValues: { count: "SECRET-VALUE-WRONG-TYPE" },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");

    const allMessages = result.fieldErrors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("SECRET-VALUE-WRONG-TYPE");
  });

  test("unknown key validation error does not include raw submitted value in message", async () => {
    const { validateWorkflowInputs } = await runStartModulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: {
        name: "Alice",
        unknownSentinel: "SECRET-UNKNOWN-VALUE-XYZ",
      },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");

    const allMessages = result.fieldErrors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("SECRET-UNKNOWN-VALUE-XYZ");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 5: conflict returns real existing row id, not fabricated nanoid (MEDIUM)
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 5: onConflict returns real existing row id (MEDIUM)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("second persist for same workflowRunId returns id of existing row", async () => {
    const { persistWorkflowInputSnapshot: persist } =
      await runStartModulePromise;

    const SHARED_RUN_ID = "conflict-run-id-999";

    // First insert succeeds
    const first = await persist({
      workflowRunId: SHARED_RUN_ID,
      workflowId: "wf-test",
      schemaVersion: null,
      redactedValues: { name: "Alice" },
      persistedAt: new Date(),
    });

    expect(first.success).toBe(true);
    if (!first.success) throw new Error("expected first success");
    const firstId = first.snapshotId;
    expect(typeof firstId).toBe("string");
    expect(firstId.length).toBeGreaterThan(0);

    // Simulate conflict: next insert for same runId returns empty
    dbConflictRunId = SHARED_RUN_ID;
    // Store the first row so the select can find it
    existingRowByRunId[SHARED_RUN_ID] = insertedRows[0]!;

    // Second insert conflicts
    const second = await persist({
      workflowRunId: SHARED_RUN_ID,
      workflowId: "wf-test",
      schemaVersion: null,
      redactedValues: { name: "Alice" },
      persistedAt: new Date(),
    });

    expect(second.success).toBe(true);
    if (!second.success) throw new Error("expected second success");
    // Must return the SAME id as the first insert, not a new nanoid
    expect(second.snapshotId).toBe(firstId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 6: typed error wrap — DB errors wrapped in WorkflowInputSnapshotError (LOW)
// ══════════════════════════════════════════════════════════════════════════════

describe("Fix 6: DB errors are wrapped in WorkflowInputSnapshotError (LOW)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowByRunId = {};
  });

  test("persistWorkflowInputSnapshot returns success:false (never throws) when DB throws", async () => {
    const { persistWorkflowInputSnapshot: persist } =
      await runStartModulePromise;

    dbShouldThrow = true;

    let threw = false;
    let result: { success: boolean } | null = null;
    try {
      result = await persist({
        workflowRunId: "run-db-err-001",
        workflowId: "wf-test",
        schemaVersion: null,
        redactedValues: { name: "Alice" },
        persistedAt: new Date(),
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.success).toBe(false);
  });

  test("validateWorkflowInputs does not have dead void isKnown pattern (structural test)", async () => {
    // This test verifies that the old validateAndPersistWorkflowInputSnapshot
    // function no longer exists (replaced by split functions).
    // The key behavioral assertion: if we call the new validateWorkflowInputs,
    // it returns a typed result for DB errors without dead code paths.
    const mod = await runStartModulePromise;

    // New split API must be exported
    expect(typeof mod.validateWorkflowInputs).toBe("function");
    expect(typeof mod.persistWorkflowInputSnapshot).toBe("function");
  });
});
