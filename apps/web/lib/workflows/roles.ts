/**
 * Workflow-layer roles surface for the web app.
 *
 * This file is the single import point for role types and the ROLE_REGISTRY
 * within apps/web. It re-exports the authoritative definitions from
 * packages/agent without duplicating registry entries or schema.
 *
 * Downstream consumers (#56, #57, #58) import from here rather than directly
 * from the agent package, keeping the dependency direction clean:
 *   apps/web -> packages/agent (never the reverse).
 *
 * Do NOT define registry entries or Zod schemas in this file.
 */
import type { RoleContract, RoleId } from "@open-agents/agent";
import { ROLE_REGISTRY } from "@open-agents/agent";

export {
  parseRoleContract,
  ROLE_REGISTRY,
  roleContractSchema,
  roleIdSchema,
  roleFamilySchema,
  type RoleContract,
  type RoleContractError,
  type RoleContractErrorKind,
  type RoleFamily,
  type RoleId,
} from "@open-agents/agent";

// ---------------------------------------------------------------------------
// Workflow-layer display helpers (consumed by #58 Runtime Inspector)
// ---------------------------------------------------------------------------

/**
 * Returns the human-readable label for a role id.
 * Used by #58 to render role status chips.
 */
export function getRoleLabel(roleId: RoleId): string {
  return ROLE_REGISTRY[roleId].label;
}

/**
 * Returns all role contracts as an ordered array.
 * Useful for listing available roles in the Runtime Inspector UI.
 */
export function listRoles(): RoleContract[] {
  return Object.values(ROLE_REGISTRY);
}

/**
 * Looks up a single role contract by id.
 */
export function lookupRole(roleId: RoleId): RoleContract {
  return ROLE_REGISTRY[roleId];
}
