/**
 * RED tests for issue-46 final fix B: prototype-pollution hardening
 *
 * Fix B (MEDIUM — cheap hardening):
 *   - buildRedactedSnapshot uses `field.key in inputValues` (walks prototype chain).
 *     An inherited declared-key value bypasses unknown-key check yet gets persisted.
 *   - Fix: use Object.hasOwn(inputValues, field.key) in buildRedactedSnapshot.
 *   - Tighten the plain-object guard to reject objects whose prototype is neither
 *     Object.prototype nor null.
 *   - Reject __proto__ / constructor / prototype as field keys during validation.
 *
 * Written BEFORE implementation — all tests must fail initially.
 * Run with: bun test apps/web/lib/workflows/run-start.prototype-pollution.test.ts
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB fake ──────────────────────────────────────────────────────────────────

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

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (row: InsertedRow) => ({
      onConflictDoNothing: (_config: unknown) => ({
        returning: (_fields: unknown) => {
          if (dbShouldThrow) throw new Error("simulated DB error");
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

const schemaDeclaredKey = {
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

const schemaWithProtoKeyAsField = {
  fields: [
    {
      key: "__proto__",
      label: "Proto",
      kind: "string" as const,
      required: false,
      sensitive: false,
    },
  ],
};

const schemaWithConstructorKeyAsField = {
  fields: [
    {
      key: "constructor",
      label: "Constructor",
      kind: "string" as const,
      required: false,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fix B: prototype-pollution hardening in buildRedactedSnapshot", () => {
  beforeEach(() => {
    insertedRows = [];
    dbShouldThrow = false;
  });

  // BT-B-001: Object.create({declaredKey:'INHERITED'}) — inherited value must NOT be persisted
  // If buildRedactedSnapshot uses `in` instead of Object.hasOwn, the inherited value
  // is picked up and persisted even though it was never in the own-key inputValues.
  test("BT-B-001: inherited declared-key value is NOT persisted (Object.hasOwn, not 'in')", async () => {
    const { validateWorkflowInputs, persistWorkflowInputSnapshot: persist } =
      await modulePromise;

    // Create an object that INHERITS 'declaredKey' from its prototype
    // but does NOT own it. This bypasses the Object.keys() unknown-key check
    // in validateInputValues (which uses own keys) but 'in' would still find it.
    const inheritedInput = Object.create({
      declaredKey: "INHERITED-VALUE",
    }) as Record<string, unknown>;
    // Add own 'name' key so validation passes
    inheritedInput["name"] = "Alice";

    // Validation uses Object.keys() (own keys only) — so {name:'Alice'} is what's seen.
    // The unknown-key check only sees 'name' (own key) — no unknown key error.
    const validation = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaDeclaredKey,
      schemaVersion: null,
      inputValues: inheritedInput,
      userId: "user-001",
    });

    if (validation.valid) {
      // If validation passes, the redacted values must NOT include the inherited value
      // 'declaredKey' was not an OWN property, so it must be absent from redactedValues
      expect(Object.hasOwn(validation.redactedValues, "declaredKey")).toBe(
        false,
      );
      expect(validation.redactedValues["declaredKey"]).toBeUndefined();

      // The stored row must not contain the inherited value
      const persistResult = await persist({
        workflowRunId: "run-proto-001",
        workflowId: "wf-test",
        schemaVersion: null,
        redactedValues: validation.redactedValues,
        persistedAt: new Date(),
      });

      if (persistResult.success) {
        expect(insertedRows).toHaveLength(1);
        const stored = insertedRows[0]?.inputValues ?? {};
        // INHERITED-VALUE must never appear in stored row
        expect(JSON.stringify(stored)).not.toContain("INHERITED-VALUE");
        // declaredKey must not be present (it was inherited, not own)
        expect(Object.hasOwn(stored, "declaredKey")).toBe(false);
      }
    } else {
      // If validation rejects due to tightened prototype guard — that's also correct.
      // The inherited value just must NOT be in stored rows.
      expect(insertedRows).toHaveLength(0);
      expect(JSON.stringify(insertedRows)).not.toContain("INHERITED-VALUE");
    }
  });

  // BT-B-002: Reject objects whose prototype is neither Object.prototype nor null
  // (e.g. class instances, Map, etc.)
  test("BT-B-002: object with non-plain prototype (class instance) is rejected as workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    class CustomClass {
      name: string = "Alice";
      constructor() {}
    }

    const classInstance = new CustomClass();

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: classInstance as unknown as Record<string, unknown>,
      userId: "user-001",
    });

    // A class instance is not a plain object — must be rejected
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure for class instance");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });

  // BT-B-003: null-prototype objects (Object.create(null)) ARE allowed (valid plain object)
  test("BT-B-003: null-prototype object (Object.create(null)) is accepted as a valid plain object", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const nullProtoInput = Object.create(null) as Record<string, unknown>;
    nullProtoInput["name"] = "Bob";

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaNameOnly,
      schemaVersion: null,
      inputValues: nullProtoInput,
      userId: "user-001",
    });

    // null-prototype plain objects should be accepted
    expect(result.valid).toBe(true);
    if (!result.valid)
      throw new Error("expected null-proto object to be accepted");
    expect(result.redactedValues["name"]).toBe("Bob");
  });

  // BT-B-004: Schema field key "__proto__" must be rejected as invalid field key
  test("BT-B-004: schema field with key '__proto__' is rejected as workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithProtoKeyAsField,
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    // A schema declaring __proto__ as a field key must be rejected
    expect(result.valid).toBe(false);
    if (result.valid)
      throw new Error("expected failure for __proto__ field key");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });

  // BT-B-005: Schema field key "constructor" must be rejected as invalid field key
  test("BT-B-005: schema field with key 'constructor' is rejected as workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithConstructorKeyAsField,
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    // A schema declaring 'constructor' as a field key must be rejected
    expect(result.valid).toBe(false);
    if (result.valid)
      throw new Error("expected failure for 'constructor' field key");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });

  // BT-B-006: 'prototype' field key in schema is also rejected
  test("BT-B-006: schema field with key 'prototype' is rejected as workflow_input_invalid", async () => {
    const { validateWorkflowInputs } = await modulePromise;

    const schemaWithPrototype = {
      fields: [
        {
          key: "prototype",
          label: "Prototype",
          kind: "string" as const,
          required: false,
          sensitive: false,
        },
      ],
    };

    const result = await validateWorkflowInputs({
      workflowId: "wf-test",
      schema: schemaWithPrototype,
      schemaVersion: null,
      inputValues: {},
      userId: "user-001",
    });

    expect(result.valid).toBe(false);
    if (result.valid)
      throw new Error("expected failure for 'prototype' field key");
    expect(result.errorKind).toBe("workflow_input_invalid");
    expect(insertedRows).toHaveLength(0);
  });
});
