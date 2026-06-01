/**
 * Sub-agent role registry and contract schemas.
 *
 * This module defines the typed vocabulary for role-specialized workers:
 * RoleId, RoleContract, ROLE_REGISTRY, and parseRoleContract.
 *
 * The role registry is an additive typed layer mapping role IDs onto the
 * existing sub-agent keys (explorer / executor / design). It does NOT alter
 * SUBAGENT_REGISTRY, SUBAGENT_TYPES, or the agentRole DB enum.
 *
 * Pattern mirrors apps/web/lib/model-variants.ts:
 *   named sub-schemas → composed z.object → z.infer types → .refine()
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const roleIdSchema = z.enum([
  "locator",
  "researcher",
  "implementer",
  "reviewer",
  "verifier",
  "simplifier",
  "debugger",
]);

export type RoleId = z.infer<typeof roleIdSchema>;

export const roleFamilySchema = z.enum(["read", "write", "design", "review"]);

export type RoleFamily = z.infer<typeof roleFamilySchema>;

const subagentTypeEnumSchema = z.enum(["explorer", "executor", "design"]);

const allowedToolSchema = z.enum([
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
]);

// ---------------------------------------------------------------------------
// Role contract schema
// ---------------------------------------------------------------------------

export const roleContractSchema = z.object({
  id: roleIdSchema,
  label: z.string(),
  description: z.string(),
  family: roleFamilySchema,
  allowedTools: z.array(allowedToolSchema),
  forbiddenScope: z.array(z.string()).optional(),
  requiredOutputs: z.array(z.string()).min(1),
  boundSubagent: z.union([subagentTypeEnumSchema, z.null()]),
});

export type RoleContract = z.infer<typeof roleContractSchema>;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export type RoleContractErrorKind =
  | "role_contract_invalid"
  | "unknown_role"
  | "forbidden_scope_violation"
  | "missing_required_output"
  | "duplicate_role_id";

export type RoleContractError =
  | { kind: "role_contract_invalid" }
  | { kind: "unknown_role"; id: string }
  | { kind: "forbidden_scope_violation"; roleId: string; violation: string }
  | { kind: "missing_required_output"; roleId: string }
  | { kind: "duplicate_role_id"; id: string };

// ---------------------------------------------------------------------------
// ROLE_REGISTRY — 7 role contracts (frozen)
// ---------------------------------------------------------------------------

const ROLE_REGISTRY_ENTRIES: Record<RoleId, RoleContract> = {
  locator: {
    id: "locator",
    label: "Locator",
    description:
      "Locates relevant files, symbols, and code paths in a codebase. " +
      "Read-only: does not modify files.",
    family: "read",
    allowedTools: ["read", "grep", "glob"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["file-list"],
    boundSubagent: "explorer",
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    description:
      "Researches a topic within the codebase and produces a structured summary. " +
      "Read-only: does not modify files.",
    family: "read",
    allowedTools: ["read", "grep", "glob", "bash"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["summary"],
    boundSubagent: "explorer",
  },
  implementer: {
    id: "implementer",
    label: "Implementer",
    description:
      "Implements well-scoped changes: edits, scaffolding, refactors, and file writes. " +
      "Produces a diff as evidence of work.",
    family: "write",
    allowedTools: ["read", "write", "edit", "grep", "glob", "bash"],
    forbiddenScope: [],
    requiredOutputs: ["diff"],
    boundSubagent: "executor",
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    description:
      "Reviews code or artifacts against acceptance criteria and produces a review report. " +
      "UNBOUND in v1: launching this role is deferred to a future review sub-agent.",
    family: "review",
    allowedTools: ["read", "grep", "glob"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["review-report"],
    boundSubagent: null,
  },
  verifier: {
    id: "verifier",
    label: "Verifier",
    description:
      "Verifies that changes satisfy the stated goal and all required outputs are present. " +
      "UNBOUND in v1: launching this role is deferred to a future review sub-agent.",
    family: "review",
    allowedTools: ["read", "grep", "glob", "bash"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["verification-report"],
    boundSubagent: null,
  },
  simplifier: {
    id: "simplifier",
    label: "Simplifier",
    description:
      "Identifies unnecessary complexity and proposes simplifications without altering behavior. " +
      "UNBOUND in v1: launching this role is deferred to a future review sub-agent.",
    family: "review",
    allowedTools: ["read", "grep", "glob"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["simplification-proposal"],
    boundSubagent: null,
  },
  debugger: {
    id: "debugger",
    label: "Debugger",
    description:
      "Diagnoses failures by tracing execution paths and producing a root-cause analysis. " +
      "UNBOUND in v1: launching this role is deferred to a future review sub-agent.",
    family: "review",
    allowedTools: ["read", "grep", "glob", "bash"],
    forbiddenScope: ["write", "edit"],
    requiredOutputs: ["root-cause-analysis"],
    boundSubagent: null,
  },
};

/**
 * Frozen registry of all 7 role contracts.
 * Roles bind to existing sub-agent keys (explorer / executor / design) via
 * boundSubagent. Review-family roles are UNBOUND (null) in v1.
 *
 * This registry is NOT the SUBAGENT_REGISTRY and does NOT alter it.
 */
export const ROLE_REGISTRY: Readonly<Record<RoleId, RoleContract>> =
  Object.freeze(ROLE_REGISTRY_ENTRIES);

// ---------------------------------------------------------------------------
// Loose id schema — accepts any string so we can distinguish unknown_role
// from role_contract_invalid. Zod's roleIdSchema only accepts the 7 valid ids;
// we need to validate the id's presence in ROLE_REGISTRY separately.
// ---------------------------------------------------------------------------

const looseRoleContractSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  family: roleFamilySchema,
  allowedTools: z.array(allowedToolSchema),
  forbiddenScope: z.array(z.string()).optional(),
  requiredOutputs: z.array(z.string()),
  boundSubagent: z.union([subagentTypeEnumSchema, z.null()]),
});

// ---------------------------------------------------------------------------
// parseRoleContract — public API
// ---------------------------------------------------------------------------

const READ_FAMILY_FORBIDDEN_TOOLS = new Set(["write", "edit"]);

/**
 * Parses and validates a role contract definition.
 *
 * Returns a discriminated union:
 *   { ok: true; data: RoleContract }
 * | { ok: false; error: RoleContractError }
 *
 * Never throws, even for garbage input.
 */
export function parseRoleContract(
  def: unknown,
): { ok: true; data: RoleContract } | { ok: false; error: RoleContractError } {
  // --- Loose shape validation: accept any string id so we can emit
  //     unknown_role before role_contract_invalid ---
  const looseResult = looseRoleContractSchema.safeParse(def);

  if (!looseResult.success) {
    // The shape is invalid. Before giving up, check for the special case where
    // requiredOutputs is an empty array (missing_required_output takes precedence
    // when the rest of the shape is otherwise parseable but for that field).
    if (typeof def === "object" && def !== null && !Array.isArray(def)) {
      const candidate = def as Record<string, unknown>;

      if (
        Array.isArray(candidate["requiredOutputs"]) &&
        candidate["requiredOutputs"].length === 0
      ) {
        const idCheck = roleIdSchema.safeParse(candidate["id"]);
        if (idCheck.success) {
          return {
            ok: false,
            error: {
              kind: "missing_required_output",
              roleId: idCheck.data,
            },
          };
        }
      }
    }

    return {
      ok: false,
      error: { kind: "role_contract_invalid" },
    };
  }

  const loose = looseResult.data;

  // --- unknown_role: id not present in ROLE_REGISTRY ---
  // This check runs before the strict Zod parse so an unknown id gets this
  // error rather than role_contract_invalid.
  if (!(loose.id in ROLE_REGISTRY)) {
    return {
      ok: false,
      error: { kind: "unknown_role", id: loose.id },
    };
  }

  // --- missing_required_output: requiredOutputs is empty ---
  if (loose.requiredOutputs.length === 0) {
    return {
      ok: false,
      error: {
        kind: "missing_required_output",
        roleId: loose.id,
      },
    };
  }

  // --- Strict parse to validate the id enum and requiredOutputs .min(1) ---
  const strictResult = roleContractSchema.safeParse(def);
  if (!strictResult.success) {
    return {
      ok: false,
      error: { kind: "role_contract_invalid" },
    };
  }

  const contract = strictResult.data;

  // --- forbidden_scope_violation ---
  // A read-family role must not declare write or edit in allowedTools.
  if (contract.family === "read") {
    for (const tool of contract.allowedTools) {
      if (READ_FAMILY_FORBIDDEN_TOOLS.has(tool)) {
        return {
          ok: false,
          error: {
            kind: "forbidden_scope_violation",
            roleId: contract.id,
            violation: tool,
          },
        };
      }
    }
  }

  // Also check allowedTools ∩ forbiddenScope (all families).
  if (contract.forbiddenScope && contract.forbiddenScope.length > 0) {
    const forbidden = new Set(contract.forbiddenScope);
    for (const tool of contract.allowedTools) {
      if (forbidden.has(tool)) {
        return {
          ok: false,
          error: {
            kind: "forbidden_scope_violation",
            roleId: contract.id,
            violation: tool,
          },
        };
      }
    }
  }

  return { ok: true, data: contract };
}
