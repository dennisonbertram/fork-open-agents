import { z } from "zod";

// ── Field kinds ────────────────────────────────────────────────────────────────
// The first-release set is intentionally minimal (expandable in #48).
// Arbitrary JSON Schema support beyond these five kinds is explicitly out of scope.

export const SUPPORTED_FIELD_KINDS = [
  "string",
  "number",
  "boolean",
  "enum",
  "secret",
] as const;

export type WorkflowFieldKind = (typeof SUPPORTED_FIELD_KINDS)[number];

// ── Error taxonomy ─────────────────────────────────────────────────────────────
// Each error kind is a typed discriminated shape carrying enough context to
// be actionable by downstream consumers (#46, #47).

export type WorkflowInputSchemaErrorKind =
  | "input_schema_invalid"
  | "unsupported_field_kind"
  | "sensitive_field_unmarked"
  | "duplicate_field_key"
  | "enum_missing_values";

export type WorkflowInputSchemaError =
  | {
      kind: "input_schema_invalid";
      message: string;
    }
  | {
      kind: "unsupported_field_kind";
      message: string;
      fieldKey: string;
      received: string;
    }
  | {
      kind: "sensitive_field_unmarked";
      message: string;
      fieldKey: string;
    }
  | {
      kind: "duplicate_field_key";
      message: string;
      key: string;
    }
  | {
      kind: "enum_missing_values";
      message: string;
      fieldKey: string;
    };

// ── Named sub-schemas (mirror the model-variants.ts pattern) ─────────────────

const fieldKeySchema = z
  .string()
  .min(1, "field key must be a non-empty string");
const fieldLabelSchema = z
  .string()
  .min(1, "field label must be a non-empty string");
const fieldDescriptionSchema = z.string().optional();

// default can be a string, number, or boolean — type-compatibility with kind
// is checked during post-parse validation.
const fieldDefaultSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .optional();

// allowedValues is required and non-empty for enum kind; prohibited for others.
// We accept it as an optional string array here and enforce the constraint in
// the post-parse validation logic.
const fieldAllowedValuesSchema = z.array(z.string()).optional();

// ── Raw field schema ──────────────────────────────────────────────────────────
// Accept kind as z.string() initially so we can surface unsupported_field_kind
// with the offending value rather than a generic Zod enum parse error.

const rawWorkflowInputFieldSchema = z.object({
  key: fieldKeySchema,
  label: fieldLabelSchema,
  kind: z.string().min(1, "kind must be a non-empty string"),
  required: z.boolean(),
  default: fieldDefaultSchema,
  description: fieldDescriptionSchema,
  // sensitive is optional in raw input; secret fields are auto-normalized.
  // If a secret field has sensitive: false explicitly, that is an error.
  sensitive: z.boolean().optional(),
  allowedValues: fieldAllowedValuesSchema,
});

type RawWorkflowInputField = z.infer<typeof rawWorkflowInputFieldSchema>;

// ── Top-level schema ──────────────────────────────────────────────────────────

const rawWorkflowInputSchemaSchema = z.object({
  fields: z.array(rawWorkflowInputFieldSchema),
});

// ── Normalized field type (post-validation) ───────────────────────────────────

export type WorkflowInputField = {
  key: string;
  label: string;
  kind: WorkflowFieldKind;
  required: boolean;
  default?: string | number | boolean;
  description?: string;
  sensitive: boolean;
  allowedValues?: string[];
};

// ── Public schema type ────────────────────────────────────────────────────────

export type WorkflowInputSchema = {
  fields: ReadonlyArray<WorkflowInputField>;
};

// ── Public API reference type (for catalog.ts consumers — see #30) ────────────
// catalog.ts uses inputSchemaRef: z.string().optional() as a placeholder today.
// Downstream slices (#30, #46, #47) may import WorkflowInputSchema directly.
export type WorkflowInputSchemaRef = WorkflowInputSchema;

// ── Internal field result type ────────────────────────────────────────────────
// A tagged union avoids relying on kind-string comparison to distinguish
// a successfully normalized field from an error value.

type FieldResult =
  | { ok: true; field: WorkflowInputField }
  | { ok: false; error: WorkflowInputSchemaError };

// ── Internal field normalization and validation ───────────────────────────────

function normalizeAndValidateField(raw: RawWorkflowInputField): FieldResult {
  const { key, kind, sensitive } = raw;

  // Check for unsupported field kind before anything else
  if (!SUPPORTED_FIELD_KINDS.includes(kind as WorkflowFieldKind)) {
    return {
      ok: false,
      error: {
        kind: "unsupported_field_kind",
        message: `Field "${key}" has unsupported kind "${kind}". Supported kinds: ${SUPPORTED_FIELD_KINDS.join(", ")}`,
        fieldKey: key,
        received: kind,
      },
    };
  }

  const validKind = kind as WorkflowFieldKind;

  // secret kind: sensitive must not be explicitly false.
  // Conservative interpretation per issue body: a secret field with
  // sensitive: false explicitly set is REJECTED as sensitive_field_unmarked.
  // If sensitive is omitted, auto-normalize to true (no error).
  if (validKind === "secret" && sensitive === false) {
    return {
      ok: false,
      error: {
        kind: "sensitive_field_unmarked",
        message: `Field "${key}" has kind "secret" but sensitive is explicitly set to false. Secret fields must always be sensitive.`,
        fieldKey: key,
      },
    };
  }

  // enum kind: allowedValues must be present and non-empty
  if (
    validKind === "enum" &&
    (!raw.allowedValues || raw.allowedValues.length === 0)
  ) {
    return {
      ok: false,
      error: {
        kind: "enum_missing_values",
        message: `Field "${key}" has kind "enum" but allowedValues is absent or empty. Enum fields require at least one allowed value.`,
        fieldKey: key,
      },
    };
  }

  // Normalize sensitive: secret → true, all others → false (unless explicitly true)
  const normalizedSensitive =
    validKind === "secret" ? true : (sensitive ?? false);

  return {
    ok: true,
    field: {
      key,
      label: raw.label,
      kind: validKind,
      required: raw.required,
      ...(raw.default !== undefined ? { default: raw.default } : {}),
      ...(raw.description !== undefined
        ? { description: raw.description }
        : {}),
      sensitive: normalizedSensitive,
      ...(raw.allowedValues !== undefined
        ? { allowedValues: raw.allowedValues }
        : {}),
    },
  };
}

// ── Canonical public function ─────────────────────────────────────────────────

/**
 * Parses and validates an unknown workflow input schema definition.
 *
 * Returns a discriminated union:
 * - { success: true; data: WorkflowInputSchema } — valid, normalized schema
 * - { success: false; error: WorkflowInputSchemaError } — typed error
 *
 * NEVER throws — all errors are returned as typed values.
 *
 * Error kinds:
 * - input_schema_invalid      — top-level shape fails Zod validation
 * - unsupported_field_kind    — field kind is not in the allowed set
 * - sensitive_field_unmarked  — secret field with sensitive: false explicitly set
 * - duplicate_field_key       — two fields share the same key
 * - enum_missing_values       — enum field with absent or empty allowedValues
 */
export function parseWorkflowInputSchema(
  def: unknown,
):
  | { success: true; data: WorkflowInputSchema }
  | { success: false; error: WorkflowInputSchemaError } {
  // Top-level structural validation
  const parseResult = rawWorkflowInputSchemaSchema.safeParse(def);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        kind: "input_schema_invalid",
        message: `Invalid workflow input schema: ${parseResult.error.issues.map((i) => i.message).join("; ")}`,
      },
    };
  }

  const { fields: rawFields } = parseResult.data;
  const normalizedFields: WorkflowInputField[] = [];
  const seenKeys = new Set<string>();

  for (const rawField of rawFields) {
    // Check for duplicate keys before field-level validation
    if (seenKeys.has(rawField.key)) {
      return {
        success: false,
        error: {
          kind: "duplicate_field_key",
          message: `Duplicate field key "${rawField.key}": all field keys must be unique within a workflow input schema`,
          key: rawField.key,
        },
      };
    }
    seenKeys.add(rawField.key);

    const fieldResult = normalizeAndValidateField(rawField);

    if (!fieldResult.ok) {
      return { success: false, error: fieldResult.error };
    }

    normalizedFields.push(fieldResult.field);
  }

  return {
    success: true,
    data: {
      fields: Object.freeze(normalizedFields),
    },
  };
}
