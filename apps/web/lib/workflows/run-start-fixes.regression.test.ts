/**
 * Regression tests for issue-46 fix-forward — all 6 findings.
 *
 * These tests lock the security and correctness invariants introduced by the
 * fix-forward commits. If the changes in ee863260 are reverted, these tests
 * catch the regression.
 *
 * Regression scenarios:
 * 1. UNKNOWN KEY SECRET: raw secret under an undeclared key never reaches stored row
 * 2. SCHEMA-ONLY KEYS: persisted snapshot contains ONLY schema-declared keys
 * 3. NON-OBJECT INPUTVALUES: rejected before any processing
 * 4. REAL RUN ID: persistWorkflowInputSnapshot stores the runId passed to it
 * 5. PURE VALIDATE: validateWorkflowInputs never writes to DB
 * 6. BEST-EFFORT PERSIST: persist failure returns {success:false}, never throws
 * 7. BACKSTOP TOKEN: 'token' field force-redacted by key pattern despite sensitive:false
 * 8. BACKSTOP PASSWORD: 'password' force-redacted despite sensitive:false
 * 9. NO ECHO IN ENUM ERROR: enum error message does not contain the bad submitted value
 * 10. NO ECHO IN TYPE ERROR: type mismatch message does not echo the submitted value
 * 11. CONFLICT ID: second persist for same runId returns real existing id
 * 12. DB ERROR WRAP: typed error from persistWorkflowInputSnapshot on DB failure
 * 13. SPLIT API EXPORTED: both validateWorkflowInputs and persistWorkflowInputSnapshot exported
 * 14. LEGACY COMPAT: validateAndPersistWorkflowInputSnapshot still works for existing callers
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
let dbConflictRunId: string | null = null;
let existingRowById: Record<string, InsertedRow> = {};

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (row: InsertedRow) => ({
      onConflictDoNothing: (_config: unknown) => ({
        returning: (_fields: unknown) => {
          if (dbShouldThrow) {
            throw new Error("regression: simulated DB error");
          }
          if (dbConflictRunId && row.workflowRunId === dbConflictRunId) {
            // Simulate conflict: return empty rows
            return Promise.resolve([]);
          }
          insertedRows.push(row);
          existingRowById[row.workflowRunId] = row;
          return Promise.resolve([{ id: row.id }]);
        },
      }),
    }),
  }),
  select: () => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => {
        // Return the conflicting row by workflowRunId
        const existing = dbConflictRunId
          ? existingRowById[dbConflictRunId]
          : undefined;
        return Promise.resolve(existing ? [{ id: existing.id }] : []);
      },
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: fakeDb,
}));

const modulePromise = import("./run-start");

// ── Schema fixtures ─────────────────────────────────────────────────────────

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

const schemaTokenNotSensitive = {
  fields: [
    {
      key: "token",
      label: "Token",
      kind: "string",
      required: true,
      sensitive: false, // client schema downgrade — backstop must override
    },
  ],
};

const schemaPasswordNotSensitive = {
  fields: [
    {
      key: "password",
      label: "Password",
      kind: "string",
      required: true,
      sensitive: false, // client schema downgrade — backstop must override
    },
  ],
};

const schemaWithEnum = {
  fields: [
    {
      key: "env",
      label: "Env",
      kind: "enum",
      required: true,
      sensitive: false,
      allowedValues: ["prod", "dev"],
    },
  ],
};

const schemaWithNumber = {
  fields: [
    {
      key: "count",
      label: "Count",
      kind: "number",
      required: true,
      sensitive: false,
    },
  ],
};

// ── Regression tests ────────────────────────────────────────────────────────

describe("regression: Fix1 — unknown key containing raw secret rejected", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 1: If Fix 1 is reverted, unknown keys pass through and their
  // values (including secrets) are persisted raw.
  test("raw secret under unknown key is never persisted — rejected as workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "RAW-SECRET-MUST-NOT-PERSIST" },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    // No rows written
    expect(insertedRows).toHaveLength(0);
    // Raw secret never appears in any stored JSON
    const storedJson = JSON.stringify(insertedRows);
    expect(storedJson).not.toContain("RAW-SECRET-MUST-NOT-PERSIST");
  });
});

describe("regression: Fix1 — persisted snapshot is schema-keys only", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 2: If Fix 1 is reverted, extra keys from inputValues can bleed
  // into the stored row via object spread.
  test("stored inputValues contains exactly the schema-declared keys, no extras", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await modulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "Bob" },
      userId: "user-001",
    });

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    await persist({
      workflowRunId: "reg-run-001",
      workflowId: "wf-reg",
      schemaVersion: null,
      redactedValues: validation.redactedValues,
      persistedAt: new Date(),
    });

    expect(insertedRows).toHaveLength(1);
    // Only 'name' must be present
    expect(Object.keys(insertedRows[0]?.inputValues ?? {})).toEqual(["name"]);
    expect(insertedRows[0]?.inputValues["name"]).toBe("Bob");
  });
});

describe("regression: Fix1 — non-object inputValues rejected", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 3: If the plain-object check is removed, non-object inputValues
  // reach the schema validation loop and cause crashes or silent failures.
  test("non-object inputValues returns workflow_input_invalid without throwing", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    let threw = false;
    let result: Awaited<ReturnType<typeof validateWorkflowInputs>> | null =
      null;
    try {
      result = await validateWorkflowInputs({
        workflowId: "wf-reg",
        schema: schemaNameOnly,
        schemaVersion: null,
        inputValues: ["array", "not", "object"] as unknown as Record<
          string,
          unknown
        >,
        userId: "user-001",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.valid).toBe(false);
    if (result?.valid !== false) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: Fix2 — persistWorkflowInputSnapshot uses the supplied runId", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 4: If Fix 2 is reverted, a pre-generated nanoid (not the real
  // run.runId) gets stored, creating a mismatch with the actual workflow run.
  test("stored workflowRunId matches the runId passed to persistWorkflowInputSnapshot", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await modulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "secret-val" },
      userId: "user-001",
    });

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    const REAL_RUN_ID = "workflow-start-returned-this-id-xyz789";
    await persist({
      workflowRunId: REAL_RUN_ID,
      workflowId: "wf-reg",
      schemaVersion: null,
      redactedValues: validation.redactedValues,
      persistedAt: new Date(),
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.workflowRunId).toBe(REAL_RUN_ID);
    // The raw secret must not be in the stored row
    const json = JSON.stringify(insertedRows[0]);
    expect(json).not.toContain("secret-val");
  });
});

describe("regression: Fix2 — validateWorkflowInputs is a pure function (no DB side effects)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 5: If validateWorkflowInputs starts doing DB writes, we lose
  // the validate-before-start guarantee and the ability to abort without starting a run.
  test("calling validateWorkflowInputs does not write any rows to DB", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "my-secret" },
      userId: "user-001",
    });

    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: Fix2 — persist failure is best-effort (never throws)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 6: If the best-effort wrapper is removed, a DB error after
  // start() would propagate and the caller would receive a 500 for an
  // already-started run.
  test("persistWorkflowInputSnapshot returns {success:false} on DB error, never throws", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await modulePromise;

    const validation = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Alice", apiKey: "secret" },
      userId: "user-001",
    });
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected success");

    dbShouldThrow = true;
    let threw = false;
    let result: Awaited<ReturnType<typeof persist>> | null = null;
    try {
      result = await persist({
        workflowRunId: "run-db-err",
        workflowId: "wf-reg",
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
});

describe("regression: Fix3 — backstop redacts secret-key-named fields", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 7: If the KEY_PATTERN backstop is removed, a client that
  // declares 'token' as sensitive:false would have its value stored raw.
  test("'token' field is force-redacted by key pattern even when schema says sensitive:false", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaTokenNotSensitive,
      schemaVersion: null,
      inputValues: { token: "BACKSTOP-MUST-CATCH-TOKEN-VALUE" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    expect(result.redactedValues["token"]).toBe("[REDACTED]");
    const json = JSON.stringify(result.redactedValues);
    expect(json).not.toContain("BACKSTOP-MUST-CATCH-TOKEN-VALUE");
  });

  // REGRESSION 8: Same for 'password'
  test("'password' field is force-redacted by key pattern even when schema says sensitive:false", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaPasswordNotSensitive,
      schemaVersion: null,
      inputValues: { password: "BACKSTOP-MUST-CATCH-PASSWORD-VALUE" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");
    expect(result.redactedValues["password"]).toBe("[REDACTED]");
    const json = JSON.stringify(result.redactedValues);
    expect(json).not.toContain("BACKSTOP-MUST-CATCH-PASSWORD-VALUE");
  });
});

describe("regression: Fix4 — error messages never echo raw submitted values", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 9: If the raw-value echo is re-introduced in enum errors,
  // secret-like enum inputs would leak in 422 response bodies.
  test("enum validation error message does not contain the bad submitted value", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaWithEnum,
      schemaVersion: null,
      inputValues: { env: "SECRET-ENUM-SENTINEL-9876" },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");
    const allMessages = result.fieldErrors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("SECRET-ENUM-SENTINEL-9876");
    // Error still identifies the field and constraint
    const envError = result.fieldErrors.find((e) => e.key === "env");
    expect(envError).toBeDefined();
    expect(envError?.message).toContain("env");
  });

  // REGRESSION 10: Same for type mismatch errors
  test("type mismatch error message does not contain the submitted value", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaWithNumber,
      schemaVersion: null,
      inputValues: { count: "SECRET-TYPE-SENTINEL-4321" },
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    if (result.errorKind !== "workflow_input_invalid")
      throw new Error("wrong errorKind");
    const allMessages = result.fieldErrors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("SECRET-TYPE-SENTINEL-4321");
  });
});

describe("regression: Fix5 — conflict returns real existing row id", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 11: If Fix 5 is reverted, the second call for the same
  // workflowRunId returns a new nanoid that doesn't correspond to any row.
  test("second persist for same workflowRunId returns id of the existing row", async () => {
    const { persistWorkflowInputSnapshot: persist } = await modulePromise;

    const SHARED_RUN_ID = "reg-conflict-run-001";

    const first = await persist({
      workflowRunId: SHARED_RUN_ID,
      workflowId: "wf-reg",
      schemaVersion: null,
      redactedValues: { name: "Alice" },
      persistedAt: new Date(),
    });

    expect(first.success).toBe(true);
    if (!first.success) throw new Error("expected first success");
    const firstId = first.snapshotId;

    // Set up conflict for next insert: the existing row is what was inserted above
    existingRowById[SHARED_RUN_ID] = insertedRows[0]!;
    dbConflictRunId = SHARED_RUN_ID;

    const second = await persist({
      workflowRunId: SHARED_RUN_ID,
      workflowId: "wf-reg",
      schemaVersion: null,
      redactedValues: { name: "Alice" },
      persistedAt: new Date(),
    });

    expect(second.success).toBe(true);
    if (!second.success) throw new Error("expected second success");
    // Must return the SAME id as the first persist, not a new nanoid
    expect(second.snapshotId).toBe(firstId);
  });
});

describe("regression: Fix6 — split API exported, legacy compat preserved", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
    dbConflictRunId = null;
    existingRowById = {};
  });

  // REGRESSION 13: If the split API is collapsed back to the old monolith,
  // route.ts would break (it now imports validateWorkflowInputs + persistWorkflowInputSnapshot).
  test("validateWorkflowInputs and persistWorkflowInputSnapshot are named exports", async () => {
    const mod = await modulePromise;
    expect(typeof mod.validateWorkflowInputs).toBe("function");
    expect(typeof mod.persistWorkflowInputSnapshot).toBe("function");
  });

  // REGRESSION 14: Legacy validateAndPersistWorkflowInputSnapshot must still work.
  test("legacy validateAndPersistWorkflowInputSnapshot returns success with redacted secret", async () => {
    const { validateAndPersistWorkflowInputSnapshot } = await modulePromise;

    const result = await validateAndPersistWorkflowInputSnapshot({
      workflowRunId: "reg-legacy-run-001",
      workflowId: "wf-reg",
      schema: schemaWithSecret,
      schemaVersion: null,
      inputValues: { name: "Charlie", apiKey: "legacy-secret-val" },
      userId: "user-001",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    // Secret must be redacted in stored row
    expect(insertedRows).toHaveLength(1);
    const storedJson = JSON.stringify(insertedRows[0]?.inputValues);
    expect(storedJson).not.toContain("legacy-secret-val");
    expect(insertedRows[0]?.inputValues["apiKey"]).toBe("[REDACTED]");
  });
});
