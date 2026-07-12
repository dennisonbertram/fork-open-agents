import { z } from "zod";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import {
  canonicalJson,
  sha256CanonicalJson,
} from "@/lib/execution-snapshots/canonical-json";
import { extractDefinitionGuardrails } from "./definition-guardrails";
import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
  loopDefinitionSchema,
  loopGuardrailsSchema,
  type LoopGuardrails,
  type ResolvedGuardrails,
} from "./types";

const githubPermissionsSchema = z
  .object({
    contents: z.enum(["read", "write"]).optional(),
    pullRequests: z.enum(["read", "write"]).optional(),
    issues: z.enum(["read", "write"]).optional(),
    deployments: z.literal("read").optional(),
    statuses: z.literal("read").optional(),
    checks: z.literal("read").optional(),
  })
  .strict();

const permissionsSchema = z
  .object({ github: githubPermissionsSchema.optional() })
  .strict();

const resolvedGuardrailsSchema = z
  .object({
    maxStepsPerRun: z.number().int().positive(),
    maxIterations: z.number().int().positive(),
    maxRunDurationMs: z.number().int().positive(),
    stepTimeoutMs: z.number().int().positive(),
    maxAgentTurnsPerStep: z.number().int().positive(),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: ReadonlyArray<string | number>,
  context: z.RefinementCtx,
): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      context.addIssue({
        code: "unrecognized_keys",
        keys: [key],
        path: [...path],
        message: `Unrecognized key: ${key}`,
      });
    }
  }
}

const strictLoopDefinitionSnapshotSchema = z
  .unknown()
  .superRefine((value, context) => {
    rejectUnknownKeys(value, new Set(["nodes", "edges"]), [], context);
    if (!isRecord(value)) return;
    if (Array.isArray(value.nodes)) {
      value.nodes.forEach((node, index) => {
        if (!isRecord(node)) return;
        const common = ["id", "kind", "label", "position"];
        const byKind: Record<string, string[]> = {
          start: [],
          end: [],
          condition: ["condition"],
          github_check: ["check"],
          agent_step: [
            "instructions",
            "outputSchema",
            "checkCommand",
            "permissions",
            "composioToolkitSlugs",
            "builtinToolNames",
          ],
        };
        rejectUnknownKeys(
          node,
          new Set([...common, ...(byKind[String(node.kind)] ?? [])]),
          ["nodes", index],
          context,
        );
        rejectUnknownKeys(
          node.position,
          new Set(["x", "y"]),
          ["nodes", index, "position"],
          context,
        );
        if (node.kind === "condition") {
          rejectUnknownKeys(
            node.condition,
            new Set(["path", "op", "value"]),
            ["nodes", index, "condition"],
            context,
          );
        }
        if (node.kind === "github_check" && isRecord(node.check)) {
          const checkKeys: Record<string, string[]> = {
            list_issues: ["kind", "labels", "state"],
            pr_status: ["kind", "prNumberFrom"],
            deployment_status: ["kind", "environment"],
            ci_status: ["kind", "refFrom"],
          };
          rejectUnknownKeys(
            node.check,
            new Set(checkKeys[String(node.check.kind)] ?? ["kind"]),
            ["nodes", index, "check"],
            context,
          );
        }
      });
    }
    if (Array.isArray(value.edges)) {
      value.edges.forEach((edge, index) =>
        rejectUnknownKeys(
          edge,
          new Set(["id", "source", "target", "when"]),
          ["edges", index],
          context,
        ),
      );
    }
  })
  .pipe(loopDefinitionSchema);

export const agentLoopExecutionSnapshotV1Schema = z
  .object({
    snapshotVersion: z.literal(1),
    source: z
      .object({
        definitionId: z.string().min(1),
        name: z.string(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
    repository: z
      .object({ owner: z.string().min(1), name: z.string().min(1) })
      .strict(),
    definition: strictLoopDefinitionSnapshotSchema,
    guardrails: resolvedGuardrailsSchema,
    permissions: permissionsSchema,
    watchdog: z
      .object({
        enabled: z.boolean(),
        instructions: z.string().nullable(),
        retryBudget: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AgentLoopExecutionSnapshotV1 = z.infer<
  typeof agentLoopExecutionSnapshotV1Schema
>;

function normalizedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve the accepted guardrail intent. Embedded definition guardrails are
 * retained for compatibility, while the validated column wins per field.
 * Concrete values are frozen so future default changes cannot alter a Run.
 */
export function resolveAcceptedLoopGuardrails(
  definition: unknown,
  columnGuardrails: unknown,
): ResolvedGuardrails {
  const embedded = extractDefinitionGuardrails(definition);
  const parsedColumn = loopGuardrailsSchema.safeParse(columnGuardrails ?? {});
  if (!parsedColumn.success) {
    throw new AgentLoopSnapshotError(
      "snapshot_invalid",
      "Loop guardrails failed validation.",
    );
  }
  const accepted: Partial<LoopGuardrails> = {
    ...embedded,
    ...parsedColumn.data,
  };
  return applyCurrentLoopGuardrailCeilings({
    maxStepsPerRun:
      accepted.maxStepsPerRun ?? GUARDRAIL_DEFAULTS.maxStepsPerRun,
    maxIterations: accepted.maxIterations ?? GUARDRAIL_DEFAULTS.maxIterations,
    maxRunDurationMs:
      accepted.maxRunDurationMs ?? GUARDRAIL_DEFAULTS.maxRunDurationMs,
    stepTimeoutMs: accepted.stepTimeoutMs ?? GUARDRAIL_DEFAULTS.stepTimeoutMs,
    maxAgentTurnsPerStep:
      accepted.maxAgentTurnsPerStep ?? GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep,
  });
}

/** Current server ceilings may only narrow frozen intent. */
export function applyCurrentLoopGuardrailCeilings(
  frozen: ResolvedGuardrails,
): ResolvedGuardrails {
  return {
    maxStepsPerRun: Math.min(
      frozen.maxStepsPerRun,
      GUARDRAIL_CEILINGS.maxStepsPerRun,
    ),
    maxIterations: Math.min(
      frozen.maxIterations,
      GUARDRAIL_CEILINGS.maxIterations,
    ),
    maxRunDurationMs: frozen.maxRunDurationMs,
    stepTimeoutMs: Math.min(
      frozen.stepTimeoutMs,
      GUARDRAIL_CEILINGS.stepTimeoutMs,
    ),
    maxAgentTurnsPerStep: Math.min(
      frozen.maxAgentTurnsPerStep,
      GUARDRAIL_CEILINGS.maxAgentTurnsPerStep,
    ),
  };
}

export function buildAgentLoopExecutionSnapshot(
  loop: AgentLoop,
): AgentLoopExecutionSnapshotV1 {
  const definitionInput = isRecord(loop.definition)
    ? Object.fromEntries(
        Object.entries(loop.definition).filter(([key]) => key !== "guardrails"),
      )
    : loop.definition;
  const definition = strictLoopDefinitionSnapshotSchema.parse(definitionInput);
  return agentLoopExecutionSnapshotV1Schema.parse({
    snapshotVersion: 1,
    source: {
      definitionId: loop.id,
      name: loop.name,
      updatedAt: loop.updatedAt.toISOString(),
    },
    repository: { owner: loop.repoOwner, name: loop.repoName },
    definition,
    guardrails: resolveAcceptedLoopGuardrails(loop.definition, loop.guardrails),
    permissions: loop.permissions ?? {},
    watchdog: {
      enabled: loop.watchdogEnabled,
      instructions: normalizedText(loop.watchdogInstructions),
      retryBudget: loop.watchdogRetryBudget,
    },
  });
}

export function parseAgentLoopExecutionSnapshot(
  value: unknown,
): AgentLoopExecutionSnapshotV1 {
  return agentLoopExecutionSnapshotV1Schema.parse(value);
}

export function hashAgentLoopExecutionSnapshot(
  snapshot: AgentLoopExecutionSnapshotV1,
): string {
  return sha256CanonicalJson(
    agentLoopExecutionSnapshotV1Schema.parse(snapshot),
  );
}

export type AgentLoopSnapshotErrorKind =
  | "snapshot_missing"
  | "snapshot_invalid"
  | "snapshot_version_unsupported"
  | "snapshot_hash_mismatch"
  | "source_inactive"
  | "source_deleted"
  | "feature_disabled"
  | "repo_not_allowed";

export class AgentLoopSnapshotError extends Error {
  constructor(
    readonly errorKind: AgentLoopSnapshotErrorKind,
    message: string,
    readonly runId?: string,
  ) {
    super(message);
    this.name = "AgentLoopSnapshotError";
  }
}

export type ResolvedAgentLoopExecutionDefinition = {
  definition: AgentLoopExecutionSnapshotV1;
  snapshotSource: "frozen" | "legacy_live_fallback";
  definitionVersion: number | null;
  definitionHash: string | null;
};

function assertActiveSource(
  run: AgentLoopRun,
  liveLoop: AgentLoop | null,
): asserts liveLoop is AgentLoop {
  if (!liveLoop) {
    throw new AgentLoopSnapshotError(
      "source_deleted",
      "Source Automation was deleted before execution.",
    );
  }
  if (
    liveLoop.id !== run.loopId ||
    liveLoop.userId !== run.userId ||
    liveLoop.status !== "active"
  ) {
    throw new AgentLoopSnapshotError(
      "source_inactive",
      "Source Automation is no longer active.",
    );
  }
}

export function resolveAgentLoopExecutionDefinition(
  run: AgentLoopRun,
  liveLoop: AgentLoop | null,
): ResolvedAgentLoopExecutionDefinition {
  const tuple = [
    run.executionSnapshot,
    run.definitionVersion,
    run.definitionHash,
  ];
  const present = tuple.filter((value) => value != null).length;
  if (present !== 0 && present !== 3) {
    throw new AgentLoopSnapshotError(
      "snapshot_invalid",
      "Execution snapshot metadata is incomplete.",
    );
  }

  assertActiveSource(run, liveLoop);

  if (present === 0) {
    let legacy: AgentLoopExecutionSnapshotV1;
    try {
      legacy = buildAgentLoopExecutionSnapshot({
        ...liveLoop,
        definition: loopDefinitionSchema.parse(run.definitionSnapshot),
      });
    } catch {
      throw new AgentLoopSnapshotError(
        "snapshot_invalid",
        "Legacy graph snapshot failed validation.",
      );
    }
    return {
      definition: legacy,
      snapshotSource: "legacy_live_fallback",
      definitionVersion: null,
      definitionHash: null,
    };
  }

  if (run.definitionVersion !== 1) {
    throw new AgentLoopSnapshotError(
      "snapshot_version_unsupported",
      `Execution snapshot version ${String(run.definitionVersion)} is unsupported.`,
    );
  }
  let definition: AgentLoopExecutionSnapshotV1;
  try {
    definition = parseAgentLoopExecutionSnapshot(run.executionSnapshot);
  } catch {
    throw new AgentLoopSnapshotError(
      "snapshot_invalid",
      "Execution snapshot failed validation.",
    );
  }
  if (definition.snapshotVersion !== run.definitionVersion) {
    throw new AgentLoopSnapshotError(
      "snapshot_version_unsupported",
      "Execution snapshot version metadata does not match its body.",
    );
  }
  if (hashAgentLoopExecutionSnapshot(definition) !== run.definitionHash) {
    throw new AgentLoopSnapshotError(
      "snapshot_hash_mismatch",
      "Execution snapshot hash verification failed.",
    );
  }
  if (
    definition.source.definitionId !== liveLoop.id ||
    definition.source.definitionId !== run.loopId
  ) {
    throw new AgentLoopSnapshotError(
      "snapshot_invalid",
      "Execution snapshot source does not match the accepted Run.",
    );
  }
  try {
    if (
      canonicalJson(definition.definition) !==
      canonicalJson(loopDefinitionSchema.parse(run.definitionSnapshot))
    ) {
      throw new Error("graph mismatch");
    }
  } catch {
    throw new AgentLoopSnapshotError(
      "snapshot_invalid",
      "Execution snapshot graph does not match definitionSnapshot.",
    );
  }

  return {
    definition,
    snapshotSource: "frozen",
    definitionVersion: 1,
    definitionHash: run.definitionHash,
  };
}

/** Narrow, snapshot-derived policy object used by existing executors. */
export type AgentLoopExecutionPolicy = Pick<
  AgentLoop,
  "id" | "userId" | "name" | "status"
> & {
  repoOwner: string;
  repoName: string;
  definition: Record<string, unknown>;
  guardrails: ResolvedGuardrails;
  permissions: AgentLoop["permissions"];
  watchdogEnabled: boolean;
  watchdogInstructions: string | null;
  watchdogRetryBudget: number;
};

export const WATCHDOG_RETRY_BUDGET_CEILING = 5;

export function toAgentLoopExecutionPolicy(
  run: AgentLoopRun,
  liveLoop: AgentLoop | null,
): {
  loop: AgentLoopExecutionPolicy;
  snapshotSource: "frozen" | "legacy_live_fallback";
  definitionVersion: number | null;
  definitionHash: string | null;
} {
  const resolved = resolveAgentLoopExecutionDefinition(run, liveLoop);
  const frozen = resolved.definition;
  return {
    loop: {
      id: frozen.source.definitionId,
      userId: run.userId,
      name: frozen.source.name,
      status: "active",
      repoOwner: frozen.repository.owner,
      repoName: frozen.repository.name,
      definition: frozen.definition,
      guardrails: applyCurrentLoopGuardrailCeilings(frozen.guardrails),
      permissions: frozen.permissions,
      watchdogEnabled: frozen.watchdog.enabled,
      watchdogInstructions: frozen.watchdog.instructions,
      watchdogRetryBudget: Math.min(
        frozen.watchdog.retryBudget,
        WATCHDOG_RETRY_BUDGET_CEILING,
      ),
    },
    snapshotSource: resolved.snapshotSource,
    definitionVersion: resolved.definitionVersion,
    definitionHash: resolved.definitionHash,
  };
}
