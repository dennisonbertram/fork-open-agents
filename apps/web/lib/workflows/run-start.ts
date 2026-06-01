/**
 * validateAndPersistWorkflowInputSnapshot — server-side entry gate for
 * named workflow runs (#46).
 *
 * Called from apps/web/app/api/chat/route.ts BEFORE start(runAgentWorkflow, ...)
 * when workflowId is present in the ChatRequestBody (Option 1 architecture).
 *
 * Architecture decision: Option 1 (extend chat route — issue default).
 * Documented assumption: the caller supplies the declared WorkflowInputSchema
 * via args (no #30 catalog registry rewrite in this slice).
 *
 * Deferred: workflow_version_mismatch scenario requires #29/#30 catalog
 * lookup which is not yet available. The error kind is present in the
 * taxonomy but the version-comparison path is a documented stub/no-op.
 */

import { parseWorkflowInputSchema } from "./inputs";
import type { WorkflowInputSchema } from "./inputs";
import {
  WorkflowInputSnapshotError,
  persistWorkflowInputSnapshot,
} from "@/lib/db/workflow-input-snapshots";

// Re-export so tests can access the class
export { WorkflowInputSnapshotError };

// ── Error taxonomy ─────────────────────────────────────────────────────────

/**
 * Discriminated error kinds for validateAndPersistWorkflowInputSnapshot.
 *
 * - workflow_input_invalid        — input values fail validation (wrong type,
 *                                   missing required field, bad enum value, etc.)
 * - workflow_version_mismatch     — submitted schemaVersion does not match the
 *                                   catalog's current version for workflowId.
 *                                   STUBBED/DEFERRED — requires #29/#30 catalog.
 * - workflow_input_unauthorized   — caller lacks permission to start this run.
 * - workflow_input_persist_failed — DB write of the snapshot row failed.
 */
export type WorkflowRunStartErrorKind =
  | "workflow_input_invalid"
  | "workflow_version_mismatch"
  | "workflow_input_unauthorized"
  | "workflow_input_persist_failed";

// ── Per-field error shape (used by #47 for inline form errors) ─────────────

export type WorkflowFieldError = {
  key: string;
  message: string;
};

// ── Return type ────────────────────────────────────────────────────────────

export type ValidateAndPersistResult =
  | { success: true; snapshotId: string }
  | {
      success: false;
      errorKind: "workflow_input_invalid";
      fieldErrors: WorkflowFieldError[];
    }
  | {
      success: false;
      errorKind: "workflow_version_mismatch";
      currentVersion: string;
      submittedVersion: string;
    }
  | { success: false; errorKind: "workflow_input_unauthorized" }
  | { success: false; errorKind: "workflow_input_persist_failed" };

// ── Args ───────────────────────────────────────────────────────────────────

export type ValidateAndPersistArgs = {
  /** The run id (nanoid) that was allocated for this workflow run. */
  workflowRunId: string;
  /** Named workflow identifier. Nullable until catalog (#29/#30) lands. */
  workflowId?: string | null;
  /**
   * Declared input schema for the workflow.
   * Supplied by the caller (no #30 registry rewrite in this slice).
   * Can be a raw unknown (will be validated via parseWorkflowInputSchema)
   * or a pre-parsed WorkflowInputSchema.
   */
  schema: unknown;
  /**
   * Submitted input schema version. Used for version-mismatch check.
   * Deferred until #29/#30 catalog lands — currently a no-op.
   */
  schemaVersion?: string | null;
  /** Submitted input values to validate and persist (redacted before insert). */
  inputValues: Record<string, unknown>;
  /** The authenticated user id. Null/undefined = unauthorized. */
  userId: string | null | undefined;
};

// ── Redaction constant ─────────────────────────────────────────────────────

const REDACTED = "[REDACTED]";

// ── Schema-driven value validation ────────────────────────────────────────

/**
 * Validates inputValues against a normalized WorkflowInputSchema.
 * Collects ALL field errors (not fail-fast).
 * Returns an array of field errors (empty array = valid).
 */
function validateInputValues(
  schema: WorkflowInputSchema,
  inputValues: Record<string, unknown>,
): WorkflowFieldError[] {
  const errors: WorkflowFieldError[] = [];

  for (const field of schema.fields) {
    const value = inputValues[field.key];
    const isPresent = value !== undefined && value !== null && value !== "";

    // Required field check
    if (field.required && !isPresent) {
      errors.push({
        key: field.key,
        message: `Field "${field.key}" is required but was not provided.`,
      });
      continue;
    }

    // Skip further validation for optional fields that are absent
    if (!isPresent) {
      continue;
    }

    // Type checks per kind
    switch (field.kind) {
      case "string":
      case "secret": {
        if (typeof value !== "string") {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a string (got ${typeof value}).`,
          });
        }
        break;
      }
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a number (got ${typeof value}).`,
          });
        }
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a boolean (got ${typeof value}).`,
          });
        }
        break;
      }
      case "enum": {
        const allowedValues = field.allowedValues ?? [];
        if (!allowedValues.includes(String(value))) {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be one of: ${allowedValues.join(", ")} (got "${String(value)}").`,
          });
        }
        break;
      }
      // Future kinds will be added here (#48)
    }
  }

  return errors;
}

// ── Schema-driven sensitive field redaction ───────────────────────────────

/**
 * Builds a safe copy of inputValues for DB storage.
 * Every field with sensitive === true (including kind:"secret" which #45
 * auto-normalizes to sensitive:true) is replaced with the literal "[REDACTED]".
 *
 * NEVER logs raw values of sensitive fields — only the field key may appear
 * in logs/events.
 */
function redactSensitiveFields(
  schema: WorkflowInputSchema,
  inputValues: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...inputValues };

  for (const field of schema.fields) {
    if (field.sensitive && field.key in redacted) {
      redacted[field.key] = REDACTED;
    }
  }

  return redacted;
}

// ── Main function ──────────────────────────────────────────────────────────

/**
 * Validates workflow input values against the declared schema and persists an
 * immutable snapshot with sensitive fields redacted.
 *
 * Called at run-start (before start(runAgentWorkflow, ...)) when workflowId
 * is present in the request body (Option 1 architecture).
 *
 * Returns a discriminated union — NEVER throws.
 *
 * Error kinds:
 * - workflow_input_unauthorized   — userId is null/undefined
 * - workflow_input_invalid        — schema validation or value validation fails
 * - workflow_input_persist_failed — DB write failed
 * - (workflow_version_mismatch    — STUBBED/DEFERRED until #29/#30 lands)
 */
export async function validateAndPersistWorkflowInputSnapshot(
  args: ValidateAndPersistArgs,
): Promise<ValidateAndPersistResult> {
  const {
    workflowRunId,
    workflowId,
    schema: rawSchema,
    schemaVersion,
    inputValues,
    userId,
  } = args;

  // ── 1. Authorization check ─────────────────────────────────────────────
  if (!userId) {
    return { success: false, errorKind: "workflow_input_unauthorized" };
  }

  // ── 2. Parse and validate the schema definition ────────────────────────
  let schema: WorkflowInputSchema;
  const schemaResult = parseWorkflowInputSchema(rawSchema);
  if (!schemaResult.success) {
    return {
      success: false,
      errorKind: "workflow_input_invalid",
      fieldErrors: [
        {
          key: "__schema__",
          message: schemaResult.error.message,
        },
      ],
    };
  }
  schema = schemaResult.data;

  // ── 3. workflow_version_mismatch — STUBBED/DEFERRED ───────────────────
  // The #29/#30 catalog lookup is not yet available. When it lands, implement:
  //   const currentVersion = await catalogLookup(workflowId);
  //   if (schemaVersion && currentVersion && schemaVersion !== currentVersion) {
  //     return { success: false, errorKind: "workflow_version_mismatch",
  //              currentVersion, submittedVersion: schemaVersion };
  //   }
  // For now: version check is skipped — catalog not yet available.
  void schemaVersion; // suppress unused variable warning

  // ── 4. Validate input values against schema fields ────────────────────
  const fieldErrors = validateInputValues(schema, inputValues);
  if (fieldErrors.length > 0) {
    return {
      success: false,
      errorKind: "workflow_input_invalid",
      fieldErrors,
    };
  }

  // ── 5. Redact sensitive fields before persisting ───────────────────────
  // CRITICAL: redaction happens BEFORE the DB insert, never after.
  // Never log raw values of sensitive fields — only field keys may appear.
  const redactedValues = redactSensitiveFields(schema, inputValues);

  // ── 6. Persist the immutable snapshot ─────────────────────────────────
  try {
    const snapshotId = await persistWorkflowInputSnapshot({
      workflowRunId,
      workflowId: workflowId ?? null,
      schemaVersion: schemaVersion ?? null,
      inputValues: redactedValues,
      persistedAt: new Date(),
    });

    return { success: true, snapshotId };
  } catch (err) {
    // Surface DB failures — do NOT silently swallow.
    // The run must not start if the snapshot cannot be written.
    const isKnown = err instanceof WorkflowInputSnapshotError;
    void isKnown; // both paths return the same error kind
    return { success: false, errorKind: "workflow_input_persist_failed" };
  }
}
