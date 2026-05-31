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

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Deep-freezes a WorkflowDefinition so callers cannot mutate the shared object
 * or its nested arrays.
 */
function freezeDefinition(
  def: WorkflowDefinition,
): Readonly<WorkflowDefinition> {
  Object.freeze(def.capabilities);
  return Object.freeze(def);
}

/**
 * Wraps a Map so that write operations (.set / .delete / .clear) throw, making
 * the exported registry.definitions truly read-only at runtime.
 */
function readOnlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === "set" || prop === "delete" || prop === "clear") {
        return () => {
          throw new TypeError(
            `Cannot mutate a read-only registry map (attempted: ${String(prop)})`,
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as ReadonlyMap<K, V>;
}

// ── Registry builder ──────────────────────────────────────────────────────────

/**
 * Validates and builds an immutable workflow registry from an array of
 * workflow definitions. Throws WorkflowCatalogError on any violation.
 *
 * Error kinds:
 * - definition_invalid      — entry is null, undefined, a non-object, or fails
 *                             structural validation (missing/malformed fields).
 * - unsupported_proof_level — entry is otherwise valid but has a proofLevel
 *                             value not in SUPPORTED_PROOF_LEVELS.
 * - duplicate_workflow_id   — two entries share the same id.
 */
export function buildRegistry(
  definitions: ReadonlyArray<unknown>,
): WorkflowRegistry {
  const map = new Map<string, WorkflowDefinition>();

  for (const raw of definitions) {
    // Run Zod validation first so null/undefined/non-objects/missing fields are
    // uniformly caught here as definition_invalid rather than throwing a raw
    // TypeError when we later try to access properties.
    const parsed = WorkflowDefinitionSchema.safeParse(raw);

    if (!parsed.success) {
      // Check whether the ONLY failure is an invalid proofLevel enum value.
      // If so, the entry is otherwise structurally valid and deserves the more
      // specific unsupported_proof_level kind.
      const issues = parsed.error.issues;
      const onlyProofLevelFailed =
        issues.length === 1 &&
        issues[0]?.path.length === 1 &&
        issues[0].path[0] === "proofLevel";

      if (
        onlyProofLevelFailed &&
        raw !== null &&
        raw !== undefined &&
        typeof raw === "object"
      ) {
        // The raw value is an object with all required fields, but proofLevel
        // is not a recognised enum member.
        const rawProofLevel = (raw as Record<string, unknown>)["proofLevel"];
        throw new WorkflowCatalogError(
          "unsupported_proof_level",
          `proofLevel "${String(rawProofLevel)}" is not supported. Supported levels: ${SUPPORTED_PROOF_LEVELS.join(", ")}`,
        );
      }

      throw new WorkflowCatalogError(
        "definition_invalid",
        `Invalid workflow definition: ${issues.map((i) => i.message).join("; ")}`,
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

    map.set(definition.id, freezeDefinition(definition));
  }

  return { definitions: readOnlyMap(map) };
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

const _stubEntry = Object.freeze({
  id: "stub-workflow",
  version: "0.1.0",
  name: "Stub Workflow",
  description:
    "Placeholder workflow definition. Real catalog entries will be added in issue #33.",
  capabilities: Object.freeze([]) as unknown as string[],
  proofLevel: "level-1" as const,
  enabled: false,
});

export const DEFAULT_CATALOG: ReadonlyArray<WorkflowDefinition> = Object.freeze(
  [_stubEntry] as WorkflowDefinition[],
);
