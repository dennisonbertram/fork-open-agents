import { z } from "zod";

// ── Proof levels from docs/process/managed-runtime-proof-standard.md ─────────

export const SUPPORTED_PROOF_LEVELS = [
  "level-1",
  "level-2",
  "level-3",
] as const;
export type ProofLevel = (typeof SUPPORTED_PROOF_LEVELS)[number];

// ── Error taxonomy ────────────────────────────────────────────────────────────

export type WorkflowCatalogErrorKind =
  | "definition_invalid"
  | "duplicate_workflow_id"
  | "unsupported_proof_level";

export class WorkflowCatalogError extends Error {
  readonly kind: WorkflowCatalogErrorKind;

  constructor(kind: WorkflowCatalogErrorKind, message: string) {
    super(message);
    this.name = "WorkflowCatalogError";
    this.kind = kind;
  }
}

// ── Semver-ish validation ─────────────────────────────────────────────────────
// Accepts MAJOR.MINOR.PATCH with optional pre-release (-alpha.1, -beta.2, etc.)

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1, "id must be a non-empty string"),
  version: z.string().refine((v) => SEMVER_PATTERN.test(v), {
    message:
      "version must be a valid semver-ish string (e.g. 1.0.0 or 1.0.0-beta.1)",
  }),
  name: z.string().min(1, "name must be a non-empty string"),
  description: z.string(),
  capabilities: z.array(z.string()),
  proofLevel: z.enum(SUPPORTED_PROOF_LEVELS),
  enabled: z.boolean(),
  inputSchemaRef: z.string().optional(),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ── Registry type ─────────────────────────────────────────────────────────────

export type WorkflowRegistry = {
  readonly definitions: ReadonlyMap<string, WorkflowDefinition>;
};

// ── Registry builder ──────────────────────────────────────────────────────────

/**
 * Validates and builds an immutable workflow registry from an array of
 * workflow definitions. Throws WorkflowCatalogError on any violation.
 */
export function buildRegistry(
  definitions: WorkflowDefinition[],
): WorkflowRegistry {
  const map = new Map<string, WorkflowDefinition>();

  for (const raw of definitions) {
    // Validate proof level first — gives the more specific error kind
    if (!SUPPORTED_PROOF_LEVELS.includes(raw.proofLevel)) {
      throw new WorkflowCatalogError(
        "unsupported_proof_level",
        `proofLevel "${raw.proofLevel}" is not supported. Supported levels: ${SUPPORTED_PROOF_LEVELS.join(", ")}`,
      );
    }

    // Validate full shape with Zod
    const parsed = WorkflowDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new WorkflowCatalogError(
        "definition_invalid",
        `Invalid workflow definition: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }

    const definition = parsed.data;

    // Enforce unique ids
    if (map.has(definition.id)) {
      throw new WorkflowCatalogError(
        "duplicate_workflow_id",
        `Duplicate workflow id "${definition.id}": workflow ids must be unique within a registry`,
      );
    }

    map.set(definition.id, definition);
  }

  return { definitions: map };
}

// ── Lookup API ────────────────────────────────────────────────────────────────

/**
 * Returns the fully-typed WorkflowDefinition for a given id, or undefined if
 * no workflow with that id is registered.
 */
export function lookupWorkflow(
  registry: WorkflowRegistry,
  id: string,
): WorkflowDefinition | undefined {
  return registry.definitions.get(id);
}

// ── List API ──────────────────────────────────────────────────────────────────

export type ListWorkflowsOptions = {
  enabledOnly?: boolean;
};

/**
 * Returns an array of WorkflowDefinitions from the registry. Pass
 * { enabledOnly: true } to receive only definitions with enabled === true.
 */
export function listWorkflows(
  registry: WorkflowRegistry,
  options: ListWorkflowsOptions = {},
): WorkflowDefinition[] {
  const all = Array.from(registry.definitions.values());
  if (options.enabledOnly === true) {
    return all.filter((d) => d.enabled === true);
  }
  return all;
}

// ── Default stub catalog (AT MOST ONE entry — full seeding deferred to #33) ──

export const DEFAULT_CATALOG: WorkflowDefinition[] = [
  {
    id: "stub-workflow",
    version: "0.1.0",
    name: "Stub Workflow",
    description:
      "Placeholder workflow definition. Real catalog entries will be added in issue #33.",
    capabilities: [],
    proofLevel: "level-1",
    enabled: false,
  },
];
