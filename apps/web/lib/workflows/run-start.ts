/**
 * Workflow input validation and snapshot persistence for named workflow runs (#46).
 *
 * Architecture (fix-forward from issue-46 reviewer findings):
 *
 * Split into two functions:
 *
 *   1. validateWorkflowInputs(args) — PURE
 *      - Returns { valid: true, redactedValues } | { valid: false, errorKind, fieldErrors? }
 *      - NEVER throws, NEVER persists, NEVER calls start()
 *      - Performs auth check, schema parse, unknown-key rejection, value validation,
 *        and builds the redacted snapshot values.
 *
 *   2. persistWorkflowInputSnapshot(args) — BEST-EFFORT SIDE EFFECT
 *      - Takes already-redacted values + the REAL run.runId from workflow start
 *      - Returns { success: true, snapshotId } | { success: false }
 *      - NEVER throws — DB failures are caught and returned as { success: false }
 *      - Caller (route.ts) calls start() BEFORE this, so a persist failure
 *        does NOT kill an already-started run.
 *
 * Route.ts call order (#46 FIX 2 — validate BEFORE start, persist AFTER start):
 *   1. validateWorkflowInputs(args) → if invalid, return 422/403 and do NOT start()
 *   2. const run = await start(runAgentWorkflow, [...])  ← get real run.runId
 *   3. persistWorkflowInputSnapshot({ ..., workflowRunId: run.runId, redactedValues })
 *      → best-effort; log on failure, do NOT 500 after run has started.
 *
 * SECURITY INVARIANTS (all enforced before any persist):
 *
 *   1. Schema-declared keys only: the persisted snapshot is built from
 *      SCHEMA FIELDS ONLY — the client inputValues object is never spread/cloned.
 *      Unknown keys (not declared in schema) are rejected as workflow_input_invalid.
 *
 *   2. Sensitive field redaction: fields with sensitive===true → "[REDACTED]"
 *
 *   3. Key-pattern backstop (FIX 3 — defense-in-depth):
 *      Fields whose KEY matches a secret-like pattern are force-redacted REGARDLESS
 *      of the client schema's sensitive flag. This mitigates a client that
 *      declares a real secret as kind:string/sensitive:false.
 *      Pattern reused from apps/web/lib/harness/redaction.ts:
 *        authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|credential
 *      LIMITATION: this backstop is defense-in-depth only. A client-supplied
 *      schema is not fully trustworthy until #30 server-authoritative catalog
 *      lookup lands. FIX 3 materially mitigates but a follow-up to use the #30
 *      catalog is required.
 *
 *   4. Error messages never echo raw submitted values (FIX 4): only field keys
 *      and expected constraints are included in error messages.
 *
 * Note on backward compat: validateAndPersistWorkflowInputSnapshot is kept as
 * a thin compatibility wrapper for the existing test suite (run-start.test.ts)
 * and for route paths that have not yet been updated. It calls validate then
 * persist in sequence. The FK-removal + reordering is implemented in route.ts.
 */

import { parseWorkflowInputSchema } from "./inputs";
import type { WorkflowInputSchema } from "./inputs";
import {
  WorkflowInputSnapshotError,
  persistWorkflowInputSnapshot as dbPersistSnapshot,
} from "@/lib/db/workflow-input-snapshots";

// Re-export so tests can access the class
export { WorkflowInputSnapshotError };

// ── Error taxonomy ─────────────────────────────────────────────────────────

/**
 * Discriminated error kinds for workflow input validation.
 *
 * - workflow_input_invalid        — input values fail validation (wrong type,
 *                                   missing required field, bad enum value,
 *                                   unknown key not in schema, etc.)
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

// ── Return types ───────────────────────────────────────────────────────────

/**
 * Result of validateWorkflowInputs — pure, no side effects.
 */
export type ValidateWorkflowInputsResult =
  | { valid: true; redactedValues: Record<string, unknown> }
  | {
      valid: false;
      errorKind: "workflow_input_invalid";
      fieldErrors: WorkflowFieldError[];
    }
  | { valid: false; errorKind: "workflow_version_mismatch" }
  | { valid: false; errorKind: "workflow_input_unauthorized" };

/**
 * Result of persistWorkflowInputSnapshot — best-effort, never throws.
 */
export type PersistWorkflowInputSnapshotResult =
  | { success: true; snapshotId: string }
  | { success: false };

/**
 * Legacy combined result type (kept for compat — run-start.test.ts).
 */
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

export type ValidateWorkflowInputsArgs = {
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
  /** Submitted input values to validate (redacted before returning). */
  inputValues: Record<string, unknown>;
  /** The authenticated user id. Null/undefined = unauthorized. */
  userId: string | null | undefined;
};

export type PersistWorkflowInputSnapshotArgs = {
  /** The REAL run id from workflow start (NOT a pre-generated nanoid). */
  workflowRunId: string;
  /** Named workflow identifier. Nullable until catalog (#29/#30) lands. */
  workflowId?: string | null;
  /** Schema version. Nullable. */
  schemaVersion?: string | null;
  /** Already-redacted input values — MUST have sensitive fields replaced. */
  redactedValues: Record<string, unknown>;
  /** Timestamp of snapshot creation. */
  persistedAt: Date;
};

/**
 * Legacy combined args type (kept for compat — run-start.test.ts).
 */
export type ValidateAndPersistArgs = {
  /** The run id (nanoid) that was allocated for this workflow run. */
  workflowRunId: string;
  /** Named workflow identifier. Nullable until catalog (#29/#30) lands. */
  workflowId?: string | null;
  schema: unknown;
  schemaVersion?: string | null;
  inputValues: Record<string, unknown>;
  userId: string | null | undefined;
};

// ── Redaction constants ────────────────────────────────────────────────────

const REDACTED = "[REDACTED]";

/**
 * Secret-key pattern backstop (FIX 3 — defense-in-depth).
 *
 * Same patterns as apps/web/lib/harness/redaction.ts SENSITIVE_KEY_PATTERN.
 * Force-redacts any field whose KEY matches this pattern REGARDLESS of the
 * client schema's sensitive flag.
 *
 * LIMITATION: Client-supplied schema is not fully trustworthy until #30
 * server-authoritative catalog lookup lands. This backstop materially mitigates
 * but is not a full replacement. Follow-up: wire to #30 catalog.
 */
const SECRET_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|credential)/i;

// ── Schema-driven value validation ─────────────────────────────────────────

/**
 * Validates inputValues against a normalized WorkflowInputSchema.
 * Collects ALL field errors (not fail-fast).
 * Returns an array of field errors (empty array = valid).
 *
 * FIX 4: error messages NEVER include the raw submitted value.
 * FIX 1: unknown keys (not in schema) are reported as errors.
 */
function validateInputValues(
  schema: WorkflowInputSchema,
  inputValues: Record<string, unknown>,
): WorkflowFieldError[] {
  const errors: WorkflowFieldError[] = [];

  // FIX 1: Reject any key in inputValues NOT declared in the schema.
  // Build a set of declared keys for O(1) lookup.
  const declaredKeys = new Set(schema.fields.map((f) => f.key));
  for (const key of Object.keys(inputValues)) {
    if (!declaredKeys.has(key)) {
      errors.push({
        key,
        // FIX 4: message names the key but does NOT echo the raw value.
        message: `Field "${key}" is not declared in the workflow input schema.`,
      });
    }
  }

  // If there are unknown keys, return immediately — do not proceed to type checks
  // on a potentially poisoned input.
  if (errors.length > 0) {
    return errors;
  }

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

    // Type checks per kind — FIX 4: never include raw value in message
    switch (field.kind) {
      case "string":
      case "secret": {
        if (typeof value !== "string") {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a string (received ${typeof value}).`,
          });
        }
        break;
      }
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a number (received ${typeof value}).`,
          });
        }
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be a boolean (received ${typeof value}).`,
          });
        }
        break;
      }
      case "enum": {
        const allowedValues = field.allowedValues ?? [];
        if (!allowedValues.includes(String(value))) {
          // FIX 4: only include expected values, NOT the submitted value.
          errors.push({
            key: field.key,
            message: `Field "${field.key}" must be one of: ${allowedValues.join(", ")}.`,
          });
        }
        break;
      }
      // Future kinds will be added here (#48)
    }
  }

  return errors;
}

// ── Schema-driven + backstop redaction ────────────────────────────────────

/**
 * Builds a safe copy of inputValues for DB storage — SCHEMA-DECLARED KEYS ONLY.
 *
 * Security invariants (FIX 1 + FIX 3):
 *   1. Only copies keys declared in the schema. Unknown keys are dropped entirely —
 *      the client object is NEVER spread/cloned. This ensures a value under an
 *      undeclared key is never persisted, even if it looks benign.
 *   2. Redacts any field where: sensitive===true OR key matches SECRET_KEY_PATTERN
 *      (backstop — defense-in-depth for client-supplied schemas).
 *
 * NEVER logs raw values of sensitive fields — only the field key may appear in logs.
 */
function buildRedactedSnapshot(
  schema: WorkflowInputSchema,
  inputValues: Record<string, unknown>,
): Record<string, unknown> {
  // Build from schema fields ONLY — do NOT clone inputValues.
  const redacted: Record<string, unknown> = {};

  for (const field of schema.fields) {
    if (!(field.key in inputValues)) {
      // Optional field not submitted — skip entirely (not even store undefined)
      continue;
    }

    const shouldRedact =
      field.sensitive || SECRET_KEY_PATTERN.test(field.key);

    redacted[field.key] = shouldRedact ? REDACTED : inputValues[field.key];
  }

  return redacted;
}

// ── Pure validation function ───────────────────────────────────────────────

/**
 * Validates workflow input values against the declared schema and builds
 * the redacted snapshot values. PURE — no side effects, no DB access.
 *
 * Returns a discriminated union — NEVER throws.
 *
 * Error kinds:
 * - workflow_input_unauthorized   — userId is null/undefined
 * - workflow_input_invalid        — schema validation or value validation fails
 *                                   (includes unknown-key rejection — FIX 1)
 */
export async function validateWorkflowInputs(
  args: ValidateWorkflowInputsArgs,
): Promise<ValidateWorkflowInputsResult> {
  const {
    workflowId: _workflowId,
    schema: rawSchema,
    schemaVersion,
    inputValues,
    userId,
  } = args;

  // ── 1. Authorization check ───────────────────────────────────────────────
  if (!userId) {
    return { valid: false, errorKind: "workflow_input_unauthorized" };
  }

  // ── 2. Validate inputValues is a plain object ────────────────────────────
  // Defense: reject non-object inputValues before further processing.
  if (
    typeof inputValues !== "object" ||
    inputValues === null ||
    Array.isArray(inputValues)
  ) {
    return {
      valid: false,
      errorKind: "workflow_input_invalid",
      fieldErrors: [
        {
          key: "__inputValues__",
          message: "inputValues must be a plain object.",
        },
      ],
    };
  }

  // ── 3. Parse and validate the schema definition ──────────────────────────
  let schema: WorkflowInputSchema;
  const schemaResult = parseWorkflowInputSchema(rawSchema);
  if (!schemaResult.success) {
    return {
      valid: false,
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

  // ── 4. workflow_version_mismatch — STUBBED/DEFERRED ─────────────────────
  // The #29/#30 catalog lookup is not yet available. When it lands, implement:
  //   const currentVersion = await catalogLookup(workflowId);
  //   if (schemaVersion && currentVersion && schemaVersion !== currentVersion) {
  //     return { valid: false, errorKind: "workflow_version_mismatch" };
  //   }
  void schemaVersion; // suppress unused variable warning

  // ── 5. Validate input values against schema fields (includes unknown-key check)
  const fieldErrors = validateInputValues(schema, inputValues);
  if (fieldErrors.length > 0) {
    return {
      valid: false,
      errorKind: "workflow_input_invalid",
      fieldErrors,
    };
  }

  // ── 6. Build redacted snapshot values ───────────────────────────────────
  // CRITICAL: schema-declared keys only; unknown keys are dropped.
  // CRITICAL: sensitive fields AND key-pattern-matched fields → "[REDACTED]".
  const redactedValues = buildRedactedSnapshot(schema, inputValues);

  return { valid: true, redactedValues };
}

// ── Best-effort persist function ───────────────────────────────────────────

/**
 * Persists a redacted workflow input snapshot row.
 *
 * IMPORTANT: call this AFTER start(runAgentWorkflow, ...) so you have the
 * REAL run.runId. A persist failure here must NOT kill the already-started run
 * — callers must log and continue.
 *
 * Returns { success: true, snapshotId } | { success: false } — NEVER throws.
 */
export async function persistWorkflowInputSnapshot(
  args: PersistWorkflowInputSnapshotArgs,
): Promise<PersistWorkflowInputSnapshotResult> {
  try {
    const snapshotId = await dbPersistSnapshot({
      workflowRunId: args.workflowRunId,
      workflowId: args.workflowId ?? null,
      schemaVersion: args.schemaVersion ?? null,
      inputValues: args.redactedValues,
      persistedAt: args.persistedAt,
    });
    return { success: true, snapshotId };
  } catch {
    // DB errors are caught here — log field keys only, never raw values.
    // The WorkflowInputSnapshotError wrap happens inside dbPersistSnapshot (FIX 6).
    return { success: false };
  }
}

// ── Legacy combined function (backward compat) ─────────────────────────────

/**
 * Legacy combined validate-and-persist function.
 *
 * DEPRECATED in favor of the split validateWorkflowInputs + persistWorkflowInputSnapshot.
 * Kept for backward compat with existing tests (run-start.test.ts) and route.ts
 * callers that have not yet been migrated to the two-phase approach.
 *
 * Architecture note: this function calls persist synchronously after validate —
 * meaning persist failure returns workflow_input_persist_failed and the run is
 * NOT started. The new route.ts path (FIX 2) reverses this: validate first,
 * start the run, then persist best-effort. This wrapper preserves old behavior
 * for callers that haven't been updated.
 *
 * Returns a discriminated union — NEVER throws.
 */
export async function validateAndPersistWorkflowInputSnapshot(
  args: ValidateAndPersistArgs,
): Promise<ValidateAndPersistResult> {
  const {
    workflowRunId,
    workflowId,
    schema,
    schemaVersion,
    inputValues,
    userId,
  } = args;

  const validationResult = await validateWorkflowInputs({
    workflowId,
    schema,
    schemaVersion,
    inputValues,
    userId,
  });

  if (!validationResult.valid) {
    switch (validationResult.errorKind) {
      case "workflow_input_unauthorized":
        return { success: false, errorKind: "workflow_input_unauthorized" };
      case "workflow_input_invalid":
        return {
          success: false,
          errorKind: "workflow_input_invalid",
          fieldErrors: validationResult.fieldErrors,
        };
      case "workflow_version_mismatch":
        // Stubbed — currentVersion/submittedVersion not available yet
        return {
          success: false,
          errorKind: "workflow_version_mismatch",
          currentVersion: "",
          submittedVersion: schemaVersion ?? "",
        };
    }
  }

  // Persist — for the legacy path, a persist failure blocks the run
  const persistResult = await persistWorkflowInputSnapshot({
    workflowRunId,
    workflowId,
    schemaVersion,
    redactedValues: validationResult.redactedValues,
    persistedAt: new Date(),
  });

  if (!persistResult.success) {
    return { success: false, errorKind: "workflow_input_persist_failed" };
  }

  return { success: true, snapshotId: persistResult.snapshotId };
}
