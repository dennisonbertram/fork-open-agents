import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  DEFAULT_CATALOG,
  WorkflowCatalogError,
  buildRegistry,
  listWorkflows,
} from "@/lib/workflows/catalog";
import type { WorkflowDefinition } from "@/lib/workflows/catalog";

// ── Response types ────────────────────────────────────────────────────────────

/**
 * Stable, redacted projection of a workflow definition exposed over the API.
 * Deliberately omits internal fields (enabled, inputSchemaRef) that callers
 * must not depend on.
 */
export interface WorkflowCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  proofLevel: string;
  /** v1 availability semantics: mirrors `enabled` on the definition. */
  available: boolean;
  /**
   * Human-readable reason why the workflow is unavailable, or null when
   * available === true. Structured for future extension (runtime/session ctx).
   */
  disabledReason: string | null;
}

export interface WorkflowCatalogResponse {
  workflows: WorkflowCatalogEntry[];
}

/**
 * Typed error response shape for API-level failures.
 * errorKind values:
 *   - catalog_unavailable: registry build or list failed unexpectedly.
 *   - context_unsupported: (reserved for v2; not triggered in v1 static catalog)
 */
export interface WorkflowCatalogErrorResponse {
  errorKind: "catalog_unavailable" | "context_unsupported";
  message: string;
}

// ── Availability helpers ──────────────────────────────────────────────────────

/**
 * Computes availability for a single workflow definition.
 *
 * v1 semantics (documented assumption): availability == definition.enabled.
 * Future versions can extend this pure function to accept session/repo/runtime
 * context without changing the API contract.
 */
function computeAvailability(definition: WorkflowDefinition): {
  available: boolean;
  disabledReason: string | null;
} {
  if (definition.enabled) {
    return { available: true, disabledReason: null };
  }
  return {
    available: false,
    disabledReason: "Workflow is currently disabled",
  };
}

/**
 * Projects a WorkflowDefinition into the stable API response shape,
 * explicitly excluding internal fields (enabled, inputSchemaRef).
 */
function toEntry(definition: WorkflowDefinition): WorkflowCatalogEntry {
  const { available, disabledReason } = computeAvailability(definition);
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    capabilities: [...definition.capabilities],
    proofLevel: definition.proofLevel,
    available,
    disabledReason,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const registry = buildRegistry(DEFAULT_CATALOG);
    const definitions = listWorkflows(registry);
    const workflows = definitions.map(toEntry);

    return Response.json({
      workflows,
    } satisfies WorkflowCatalogResponse);
  } catch (error) {
    // Defensively catch any WorkflowCatalogError (should not occur with the
    // valid static DEFAULT_CATALOG, but must be handled per the error taxonomy).
    if (error instanceof WorkflowCatalogError || error instanceof Error) {
      console.error("[workflow-catalog] Catalog build or list failed:", error);
      return Response.json(
        {
          errorKind: "catalog_unavailable",
          message: "The workflow catalog is temporarily unavailable.",
        } satisfies WorkflowCatalogErrorResponse,
        { status: 503 },
      );
    }

    // Unknown non-Error throws — still return a safe typed response.
    console.error("[workflow-catalog] Unexpected non-Error thrown:", error);
    return Response.json(
      {
        errorKind: "catalog_unavailable",
        message: "An unexpected error occurred loading the workflow catalog.",
      } satisfies WorkflowCatalogErrorResponse,
      { status: 503 },
    );
  }
}
