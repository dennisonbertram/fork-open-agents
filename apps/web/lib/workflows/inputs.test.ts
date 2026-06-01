import { describe, expect, test } from "bun:test";

import {
  parseWorkflowInputSchema,
  type WorkflowInputSchema,
  type WorkflowInputField,
  type WorkflowInputSchemaError,
} from "./inputs";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_STRING_FIELD = {
  key: "repo-url",
  label: "Repository URL",
  kind: "string" as const,
  required: true,
};

const VALID_NUMBER_FIELD = {
  key: "timeout-seconds",
  label: "Timeout (seconds)",
  kind: "number" as const,
  required: false,
  default: 30,
};

const VALID_BOOLEAN_FIELD = {
  key: "dry-run",
  label: "Dry Run",
  kind: "boolean" as const,
  required: false,
  default: false,
};

const VALID_ENUM_FIELD = {
  key: "environment",
  label: "Environment",
  kind: "enum" as const,
  required: true,
  allowedValues: ["development", "staging", "production"],
};

const VALID_SECRET_FIELD = {
  key: "api-token",
  label: "API Token",
  kind: "secret" as const,
  required: true,
};

// ── BT-001: Valid schema with mixed field kinds parses successfully ───────────

describe("parseWorkflowInputSchema", () => {
  test("valid schema with mixed field kinds parses successfully", () => {
    const def = {
      fields: [
        VALID_STRING_FIELD,
        VALID_NUMBER_FIELD,
        VALID_BOOLEAN_FIELD,
        VALID_ENUM_FIELD,
        VALID_SECRET_FIELD,
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Typed output shape
    const data: WorkflowInputSchema = result.data;
    expect(data.fields).toHaveLength(5);

    // Non-secret fields have sensitive normalized to false
    const stringField = data.fields.find((f) => f.key === "repo-url");
    expect(stringField?.sensitive).toBe(false);

    const numberField = data.fields.find((f) => f.key === "timeout-seconds");
    expect(numberField?.sensitive).toBe(false);

    const boolField = data.fields.find((f) => f.key === "dry-run");
    expect(boolField?.sensitive).toBe(false);

    const enumField = data.fields.find((f) => f.key === "environment");
    expect(enumField?.sensitive).toBe(false);

    // Secret field has sensitive normalized to true
    const secretField = data.fields.find((f) => f.key === "api-token");
    expect(secretField?.sensitive).toBe(true);
    expect(secretField?.kind).toBe("secret");
  });

  // ── BT-002: Secret field with sensitive omitted is auto-normalized ───────────

  test("secret field with sensitive omitted is auto-normalized to sensitive: true", () => {
    const def = {
      fields: [
        {
          key: "db-password",
          label: "Database Password",
          kind: "secret",
          required: true,
          // sensitive is intentionally omitted
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.fields[0];
    expect(field?.sensitive).toBe(true);
  });

  // ── BT-003: Secret field with sensitive:false explicitly set returns error ───

  test("secret field with sensitive: false explicitly set returns sensitive_field_unmarked error", () => {
    const def = {
      fields: [
        {
          key: "api-key",
          label: "API Key",
          kind: "secret",
          required: true,
          sensitive: false, // explicitly set to false — conflicts with secret semantics
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(false);
    if (result.success) return;

    const error: WorkflowInputSchemaError = result.error;
    expect(error.kind).toBe("sensitive_field_unmarked");
    // Error must carry actionable context (the offending field key)
    if (error.kind === "sensitive_field_unmarked") {
      expect(error.fieldKey).toBe("api-key");
    }
  });

  // ── BT-004: Duplicate field key returns duplicate_field_key error ────────────

  test("duplicate field key returns duplicate_field_key error", () => {
    const def = {
      fields: [
        VALID_STRING_FIELD,
        {
          ...VALID_NUMBER_FIELD,
          key: "repo-url", // duplicate of VALID_STRING_FIELD.key
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(false);
    if (result.success) return;

    const error: WorkflowInputSchemaError = result.error;
    expect(error.kind).toBe("duplicate_field_key");
    if (error.kind === "duplicate_field_key") {
      expect(error.key).toBe("repo-url");
    }
  });

  // ── BT-005: Enum field with empty allowedValues returns enum_missing_values ──

  test("enum field with empty allowedValues returns enum_missing_values error", () => {
    const def = {
      fields: [
        {
          key: "env",
          label: "Environment",
          kind: "enum",
          required: true,
          allowedValues: [], // empty — not allowed
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(false);
    if (result.success) return;

    const error: WorkflowInputSchemaError = result.error;
    expect(error.kind).toBe("enum_missing_values");
    if (error.kind === "enum_missing_values") {
      expect(error.fieldKey).toBe("env");
    }
  });

  // ── BT-006: Unsupported field kind returns unsupported_field_kind error ───────

  test("unsupported field kind returns unsupported_field_kind error", () => {
    const def = {
      fields: [
        {
          key: "some-widget",
          label: "Some Widget",
          kind: "widget", // not in the allowed set
          required: false,
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(false);
    if (result.success) return;

    const error: WorkflowInputSchemaError = result.error;
    expect(error.kind).toBe("unsupported_field_kind");
    if (error.kind === "unsupported_field_kind") {
      expect(error.fieldKey).toBe("some-widget");
      expect(error.received).toBe("widget");
    }
  });

  // ── BT-007: Missing required top-level field returns input_schema_invalid ────

  test("missing required key field returns input_schema_invalid error", () => {
    const def = {
      fields: [
        {
          // key is missing
          label: "Some Field",
          kind: "string",
          required: true,
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(false);
    if (result.success) return;

    const error: WorkflowInputSchemaError = result.error;
    expect(error.kind).toBe("input_schema_invalid");
  });

  // ── BT-008: Required field with no default is valid ─────────────────────────

  test("required field with no default is valid", () => {
    const def = {
      fields: [
        {
          key: "goal",
          label: "Goal",
          kind: "string",
          required: true,
          // no default
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.fields[0];
    expect(field?.required).toBe(true);
    expect(field?.default).toBeUndefined();
  });

  // ── BT-009: Optional field with type-compatible default is valid ──────────────

  test("optional field with type-compatible default is valid", () => {
    const def = {
      fields: [
        {
          key: "max-retries",
          label: "Max Retries",
          kind: "number",
          required: false,
          default: 42, // number default for number kind
        },
      ],
    };

    const result = parseWorkflowInputSchema(def);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const field: WorkflowInputField = result.data.fields[0]!;
    expect(field.default).toBe(42);
  });

  // ── Never-throws: parseWorkflowInputSchema must not throw on garbage input ───

  test("parseWorkflowInputSchema does not throw on null input", () => {
    expect(() => parseWorkflowInputSchema(null)).not.toThrow();
    const result = parseWorkflowInputSchema(null);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("input_schema_invalid");
    }
  });

  test("parseWorkflowInputSchema does not throw on undefined input", () => {
    expect(() => parseWorkflowInputSchema(undefined)).not.toThrow();
    const result = parseWorkflowInputSchema(undefined);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("input_schema_invalid");
    }
  });

  test("parseWorkflowInputSchema does not throw on numeric input (42)", () => {
    expect(() => parseWorkflowInputSchema(42)).not.toThrow();
    const result = parseWorkflowInputSchema(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("input_schema_invalid");
    }
  });

  test("parseWorkflowInputSchema does not throw on empty object input {}", () => {
    expect(() => parseWorkflowInputSchema({})).not.toThrow();
    const result = parseWorkflowInputSchema({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("input_schema_invalid");
    }
  });

  test("parseWorkflowInputSchema does not throw on schema with missing fields array", () => {
    const def = { notFields: [] };
    expect(() => parseWorkflowInputSchema(def)).not.toThrow();
    const result = parseWorkflowInputSchema(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("input_schema_invalid");
    }
  });
});

// ── Catalog integration proof ─────────────────────────────────────────────────
// Proves WorkflowInputSchema from inputs.ts is compatible with catalog.ts
// without rewriting or modifying the #30 registry.

describe("catalog integration proof (WorkflowInputSchema compatibility)", () => {
  test("a parsed WorkflowInputSchema can be associated with a workflow definition by its id", async () => {
    const { buildRegistry, lookupWorkflow } = await import("./catalog");

    // Build a valid input schema using the #45 contract
    const inputSchemaResult = parseWorkflowInputSchema({
      fields: [
        {
          key: "repo-url",
          label: "Repository URL",
          kind: "string",
          required: true,
        },
      ],
    });

    expect(inputSchemaResult.success).toBe(true);
    if (!inputSchemaResult.success) return;

    const inputSchema: WorkflowInputSchema = inputSchemaResult.data;

    // catalog.ts uses inputSchemaRef: z.string().optional() as a placeholder.
    // The catalog integration proof: store the schema's conceptual id as a ref,
    // proving the types line up at the boundary.
    const schemaRef = `workflow-input-schema:${inputSchema.fields[0]?.key ?? ""}`;

    const registry = buildRegistry([
      {
        id: "demo-workflow",
        version: "1.0.0",
        name: "Demo Workflow",
        description: "Workflow with an input schema ref",
        capabilities: [],
        proofLevel: "level-1",
        enabled: true,
        inputSchemaRef: schemaRef, // catalog.ts accepts this as z.string().optional()
      },
    ]);

    const definition = lookupWorkflow(registry, "demo-workflow");
    expect(definition).toBeDefined();
    // The ref field is preserved exactly as supplied — the #45 schema id is
    // carried through the catalog definition unchanged.
    expect(definition?.inputSchemaRef).toBe(schemaRef);
    // Prove the parsed inputSchema is a real WorkflowInputSchema (not undefined)
    expect(inputSchema.fields).toHaveLength(1);
    expect(inputSchema.fields[0]?.key).toBe("repo-url");
  });

  test("a workflow definition with an invalid input schema can be identified via parseWorkflowInputSchema before registration", () => {
    // The catalog registry (owned by #30) does not validate WorkflowInputSchema
    // inline — that's #45's responsibility. This test proves that a consumer
    // can validate the input schema before or after building the registry.
    const invalidInputDef = {
      fields: [
        {
          key: "token",
          label: "Token",
          kind: "secret",
          required: true,
          sensitive: false, // explicitly false — should be rejected
        },
      ],
    };

    const result = parseWorkflowInputSchema(invalidInputDef);

    // parseWorkflowInputSchema must catch the invalid schema
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("sensitive_field_unmarked");
      // A catalog loader that validates input schemas before registration
      // would receive this typed error and reject the workflow definition.
    }
  });
});
