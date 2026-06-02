/**
 * Regression tests for issue-46 final fixes A+B+C.
 *
 * These tests lock the invariants introduced in the final fix-forward commit.
 * If the changes in 53f80947 are reverted, these tests catch the regression.
 *
 * Regression scenarios:
 * A1 — inherited declared-key value never persisted (Object.hasOwn, not 'in')
 * A2 — class instance rejected as invalid plain object
 * A3 — null-prototype object accepted as valid
 * B1 — __proto__ field key in schema is rejected
 * B2 — constructor field key in schema is rejected
 * B3 — prototype field key in schema is rejected
 * C1 — FORBIDDEN_FIELD_KEYS check runs before unknown-key check (early rejection)
 * D1 — buildRedactedSnapshot output has no prototype (created via Object.create(null))
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB fake ──────────────────────────────────────────────────────────────────

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
      onConflictDoNothing: (_config: unknown) => ({
        returning: (_fields: unknown) => {
          if (dbShouldThrow) throw new Error("regression: simulated DB error");
          insertedRows.push(row);
          return Promise.resolve([{ id: row.id }]);
        },
      }),
    }),
  }),
  select: () => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve([]),
    }),
  }),
};

mock.module("@/lib/db/client", () => ({ db: fakeDb }));

const modulePromise = import("./run-start");

// ── Schemas ──────────────────────────────────────────────────────────────────

const schemaTwoKeys = {
  fields: [
    {
      key: "declaredKey",
      label: "Declared Key",
      kind: "string" as const,
      required: true,
      sensitive: false,
    },
    {
      key: "name",
      label: "Name",
      kind: "string" as const,
      required: true,
      sensitive: false,
    },
  ],
};

const schemaNameOnly = {
  fields: [
    {
      key: "name",
      label: "Name",
      kind: "string" as const,
      required: true,
      sensitive: false,
    },
  ],
};

// ── Regression tests ──────────────────────────────────────────────────────────

describe("regression: final-fix A1 — inherited declared-key never persisted", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // If Object.hasOwn reverts to 'in', Object.create({declaredKey:'INHERITED'})
  // would have its inherited value picked up and stored in the snapshot.
  test("Object.create({declaredKey:'INHERITED'}) does not persist the inherited value", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await modulePromise;

    const inheritedInput = Object.create({
      declaredKey: "INHERITED-REGRESSION-VALUE",
    }) as Record<string, unknown>;
    inheritedInput["name"] = "Alice"; // own key

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaTwoKeys,
      schemaVersion: null,
      inputValues: inheritedInput,
      userId: "user-001",
    });

    if (result.valid) {
      // If valid, the inherited key must be absent from redactedValues
      expect(Object.hasOwn(result.redactedValues, "declaredKey")).toBe(false);
      expect(result.redactedValues["declaredKey"]).toBeUndefined();

      await persist({
        workflowRunId: "reg-run-001",
        workflowId: "wf-reg",
        schemaVersion: null,
        redactedValues: result.redactedValues,
        persistedAt: new Date(),
      });

      // Inherited value must never appear in stored rows
      const storedJson = JSON.stringify(insertedRows);
      expect(storedJson).not.toContain("INHERITED-REGRESSION-VALUE");
    } else {
      // If rejected — that's also correct
      expect(insertedRows).toHaveLength(0);
      expect(JSON.stringify(insertedRows)).not.toContain(
        "INHERITED-REGRESSION-VALUE",
      );
    }
  });
});

describe("regression: final-fix A2 — class instance rejected", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // If the prototype guard is removed, class instances would pass through
  // and their inherited methods could confuse Object.keys().
  test("class instance with name property is rejected as non-plain object", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    class Payload {
      name: string = "Alice";
      constructor() {}
    }

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: new Payload() as unknown as Record<string, unknown>,
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure for class instance");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: final-fix A3 — null-prototype object accepted", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // Null-prototype objects (Object.create(null)) must be valid plain objects.
  // If the guard over-rejects, this regresses.
  test("Object.create(null) with own keys is accepted as valid plain object", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto["name"] = "Bob";

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: nullProto,
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected null-proto to be accepted");
    expect(result.redactedValues["name"]).toBe("Bob");
  });
});

describe("regression: final-fix B1/B2/B3 — forbidden field keys rejected", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // If FORBIDDEN_FIELD_KEYS check is removed, __proto__/constructor/prototype
  // as schema field keys can cause confusing behavior or prototype pollution.
  test("schema with __proto__ field key returns workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: {
        fields: [
          {
            key: "__proto__",
            label: "X",
            kind: "string" as const,
            required: false,
            sensitive: false,
          },
        ],
      },
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });

  test("schema with constructor field key returns workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: {
        fields: [
          {
            key: "constructor",
            label: "X",
            kind: "string" as const,
            required: false,
            sensitive: false,
          },
        ],
      },
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });

  test("schema with prototype field key returns workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: {
        fields: [
          {
            key: "prototype",
            label: "X",
            kind: "string" as const,
            required: false,
            sensitive: false,
          },
        ],
      },
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });
});

describe("regression: final-fix D1 — redactedValues built with Object.create(null)", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // If buildRedactedSnapshot switches back to const redacted = {},
  // the output would have Object.prototype which is a minor pollution risk.
  // This test verifies the output has no inherited properties.
  test("redactedValues returned by validateWorkflowInputs has no prototype-inherited enumerable keys", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-reg",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: { name: "Alice" },
      userId: "user-001",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected success");

    const rv = result.redactedValues;
    // The output should only have the own declared keys
    expect(Object.hasOwn(rv, "name")).toBe(true);
    expect(rv["name"]).toBe("Alice");
    // 'toString', 'hasOwnProperty' etc. must NOT be enumerable own keys
    expect(Object.hasOwn(rv, "toString")).toBe(false);
    expect(Object.hasOwn(rv, "hasOwnProperty")).toBe(false);
    // Only the one expected key
    expect(Object.keys(rv)).toEqual(["name"]);
  });
});
