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
    get(target, prop) {
      if (prop === "set" || prop === "delete" || prop === "clear") {
        return () => {
          throw new TypeError(
            `Cannot mutate a read-only registry map (attempted: ${String(prop)})`,
          );
        };
      }
      const value = Reflect.get(target, prop, target);
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
        typeof raw === "object" &&
        Object.hasOwn(raw, "proofLevel")
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

// ── Default catalog — seeded in issue #33 ────────────────────────────────────
// All initial entries are disabled (enabled: false) because the managed
// workflow runtime that executes them has not shipped. The reason is embedded
// in each entry's description so the #31 catalog API can surface it to users.
// See docs/process/workflow-catalog-conventions.md for naming and proof-level
// conventions and guidance on adding future entries.

const _verifiedBuild = Object.freeze({
  id: "verified-build",
  version: "0.1.0",
  name: "Verified Build",
  description:
    "Runs a multi-agent verified build — coordinator spawns scoped worker cells, collects evidence bundles, and produces a go/no-go report. Not yet available: the managed workflow runtime that executes this workflow has not shipped.",
  capabilities: Object.freeze([
    "multi-agent-coordination",
    "evidence-collection",
    "build-verification",
    "go-no-go-report",
  ]) as unknown as string[],
  proofLevel: "level-3" as const,
  enabled: false,
});

const _deepResearch = Object.freeze({
  id: "deep-research",
  version: "0.1.0",
  name: "Deep Research",
  description:
    "Orchestrates a structured research sweep across documentation, issues, and code, then synthesises findings into a structured report. Not yet available: the managed workflow runtime that executes this workflow has not shipped.",
  capabilities: Object.freeze([
    "document-retrieval",
    "synthesis",
    "structured-report",
  ]) as unknown as string[],
  proofLevel: "level-1" as const,
  enabled: false,
});

const _runtimeProfileValidation = Object.freeze({
  id: "runtime-profile-validation",
  version: "0.1.0",
  name: "Runtime Profile Validation",
  description:
    "Validates a managed runtime profile by executing its setup and probe steps in a sandbox and asserting all required tools are present and correctly versioned. Not yet available: the managed workflow runtime that executes this workflow has not shipped.",
  capabilities: Object.freeze([
    "sandbox-execution",
    "tool-probe",
    "profile-validation",
  ]) as unknown as string[],
  proofLevel: "level-2" as const,
  enabled: false,
});

const _releaseSmoke = Object.freeze({
  id: "release-smoke",
  version: "0.1.0",
  name: "Release Smoke",
  description:
    "Runs a post-deploy production smoke against key user-visible paths and surfaces a pass/fail report linked to the deployed commit. Not yet available: the managed workflow runtime that executes this workflow has not shipped.",
  capabilities: Object.freeze([
    "production-smoke",
    "deployment-verification",
    "user-path-check",
  ]) as unknown as string[],
  proofLevel: "level-3" as const,
  enabled: false,
});

export const DEFAULT_CATALOG: ReadonlyArray<WorkflowDefinition> = Object.freeze(
  [
    _verifiedBuild,
    _deepResearch,
    _runtimeProfileValidation,
    _releaseSmoke,
  ] as WorkflowDefinition[],
);
