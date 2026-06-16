/**
 * Agent Loops — type definitions
 *
 * Zod schemas for LoopNode (discriminated union on kind), LoopEdge,
 * LoopDefinition, LoopGuardrails, and the validation error taxonomy.
 *
 * All schemas use z.infer for derived types — never use `any`.
 *
 * Server-side guardrail ceilings are exported as named constants for use
 * in the executor (M1-05/M1-06) and the store gate.
 */

import { z } from "zod";

// ── Guardrail constants ────────────────────────────────────────────────────────

/** Server-enforced ceiling values. User guardrails are clamped to these. */
export const GUARDRAIL_CEILINGS = {
  maxStepsPerRun: 200,
  maxIterations: 50,
  /** No server ceiling on maxRunDurationMs per the spec. */
  maxRunDurationMs: undefined as undefined,
  stepTimeoutMs: 30 * 60 * 1000, // 30 minutes
} as const;

/** Default guardrail values applied when not specified. */
export const GUARDRAIL_DEFAULTS = {
  maxStepsPerRun: 50,
  maxIterations: 10,
  maxRunDurationMs: 2 * 60 * 60 * 1000, // 2 hours
  stepTimeoutMs: 10 * 60 * 1000, // 10 minutes
} as const;

// ── Node position schema ───────────────────────────────────────────────────────

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// ── Condition spec schema ─────────────────────────────────────────────────────

export const conditionOpSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "contains",
]);

export type ConditionOp = z.infer<typeof conditionOpSchema>;

export const conditionSchema = z.object({
  path: z.string().min(1),
  op: conditionOpSchema,
  value: z.unknown().optional(),
});

export type Condition = z.infer<typeof conditionSchema>;

// ── github_check spec schema ──────────────────────────────────────────────────

export const githubCheckSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list_issues"),
    labels: z.array(z.string()).optional(),
    state: z.enum(["open", "closed"]).optional(),
  }),
  z.object({
    kind: z.literal("pr_status"),
    prNumberFrom: z.string().min(1),
  }),
  z.object({
    kind: z.literal("deployment_status"),
    environment: z.string().optional(),
  }),
  z.object({
    kind: z.literal("ci_status"),
    refFrom: z.string().min(1),
  }),
]);

export type GithubCheck = z.infer<typeof githubCheckSchema>;

// ── JsonSchemaLite (for agent_step outputSchema) ──────────────────────────────

export const jsonSchemaLiteSchema = z.record(z.string(), z.unknown());
export type JsonSchemaLite = z.infer<typeof jsonSchemaLiteSchema>;

// ── LoopNode discriminated union ──────────────────────────────────────────────

const baseNodeFields = {
  id: z.string().min(1),
  label: z.string(),
  position: positionSchema,
};

export const startNodeSchema = z.object({
  ...baseNodeFields,
  kind: z.literal("start"),
});

/**
 * Per-step GitHub permissions (B-P1). Mirrors BackgroundAgentPermissions so a
 * loop agent_step can be granted the same scopes as a background agent — e.g.
 * issues:write so the agent can `gh issue create`, pull_requests:write to open
 * PRs. Structurally identical to BackgroundAgentPermissions (db/schema.ts).
 */
export const stepPermissionsSchema = z
  .object({
    github: z
      .object({
        contents: z.enum(["read", "write"]).optional(),
        pullRequests: z.enum(["read", "write"]).optional(),
        issues: z.enum(["read", "write"]).optional(),
        deployments: z.literal("read").optional(),
        statuses: z.literal("read").optional(),
        checks: z.literal("read").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const agentStepNodeSchema = z.object({
  ...baseNodeFields,
  kind: z.literal("agent_step"),
  instructions: z.string().optional(),
  outputSchema: jsonSchemaLiteSchema.optional(),
  checkCommand: z.string().optional(),
  permissions: stepPermissionsSchema.optional(),
  /**
   * Composio toolkit slugs this step's agent may use (B-P2). Resolved at run
   * time via resolveComposioToolsForBgRun, gated by the user's connected
   * accounts + repo policy. Empty/absent = no external tools.
   */
  composioToolkitSlugs: z.array(z.string()).optional(),
  /**
   * Allowlist of built-in tool NAMES this unattended step may call. `null`/
   * absent = the default policy (all built-in tools). When set, the agent only
   * sees these built-in tools — e.g. omit `web_fetch` so the step can never make
   * an approval-gated network call that would stall an unattended run. Composio
   * tools (composioToolkitSlugs) are governed separately and always pass.
   */
  builtinToolNames: z.array(z.string()).nullish(),
});

export const githubCheckNodeSchema = z.object({
  ...baseNodeFields,
  kind: z.literal("github_check"),
  check: githubCheckSchema.optional(),
});

export const conditionNodeSchema = z.object({
  ...baseNodeFields,
  kind: z.literal("condition"),
  condition: conditionSchema.optional(),
});

export const endNodeSchema = z.object({
  ...baseNodeFields,
  kind: z.literal("end"),
});

export const loopNodeSchema = z.discriminatedUnion("kind", [
  startNodeSchema,
  agentStepNodeSchema,
  githubCheckNodeSchema,
  conditionNodeSchema,
  endNodeSchema,
]);

export type LoopNodeKind =
  | "start"
  | "agent_step"
  | "github_check"
  | "condition"
  | "end";
export type StartNode = z.infer<typeof startNodeSchema>;
export type AgentStepNode = z.infer<typeof agentStepNodeSchema>;
export type GithubCheckNode = z.infer<typeof githubCheckNodeSchema>;
export type ConditionNode = z.infer<typeof conditionNodeSchema>;
export type EndNode = z.infer<typeof endNodeSchema>;
export type LoopNode = z.infer<typeof loopNodeSchema>;

// ── LoopEdge schema ───────────────────────────────────────────────────────────

export const edgeWhenSchema = z.enum([
  "success",
  "failure",
  "true",
  "false",
  "always",
]);

export type EdgeWhen = z.infer<typeof edgeWhenSchema>;

export const loopEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  when: edgeWhenSchema,
});

export type LoopEdge = z.infer<typeof loopEdgeSchema>;

// ── LoopDefinition schema ─────────────────────────────────────────────────────

export const loopDefinitionSchema = z.object({
  nodes: z.array(loopNodeSchema),
  edges: z.array(loopEdgeSchema),
});

export type LoopDefinition = z.infer<typeof loopDefinitionSchema>;

// ── LoopGuardrails schema ─────────────────────────────────────────────────────

export const loopGuardrailsSchema = z
  .object({
    maxStepsPerRun: z.number().int().positive().optional(),
    maxIterations: z.number().int().positive().optional(),
    maxRunDurationMs: z.number().int().positive().optional(),
    stepTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type LoopGuardrails = z.infer<typeof loopGuardrailsSchema>;

// ── Error taxonomy ────────────────────────────────────────────────────────────

/**
 * Error kinds returned by validateLoopDefinition.
 *
 * - loop_invalid: structural zod failure (bad shape/types)
 *
 * Graph rule errors all share kind "loop_invalid" but carry a discriminating
 * `rule` field so downstream consumers (API, M2 builder) can render inline
 * errors at the appropriate node/edge.
 */
export type LoopValidationErrorKind = "loop_invalid";

export type LoopValidationError =
  | {
      kind: "loop_invalid";
      rule: "no_start";
      message: string;
    }
  | {
      kind: "loop_invalid";
      rule: "multiple_start";
      message: string;
      nodeIds: string[];
    }
  | {
      kind: "loop_invalid";
      rule: "no_end";
      message: string;
    }
  | {
      kind: "loop_invalid";
      rule: "dangling_edge";
      message: string;
      edgeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "no_outgoing_edge";
      message: string;
      nodeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "missing_condition_edge";
      message: string;
      nodeId: string;
      branch: "true" | "false";
    }
  | {
      kind: "loop_invalid";
      rule: "invalid_when";
      message: string;
      edgeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "duplicate_when";
      message: string;
      sourceNodeId: string;
      when: string;
      edgeIds: string[];
    }
  | {
      kind: "loop_invalid";
      rule: "end_unreachable";
      message: string;
    }
  | {
      kind: "loop_invalid";
      rule: "definition_too_large";
      message: string;
      byteSize: number;
    }
  | {
      kind: "loop_invalid";
      rule: "forbidden_node_id";
      message: string;
      nodeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "missing_node_config";
      message: string;
      nodeId: string;
      nodeKind: LoopNodeKind;
    }
  | {
      kind: "loop_invalid";
      rule: "missing_condition_value";
      message: string;
      nodeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "schema_error";
      message: string;
    }
  | {
      kind: "loop_invalid";
      rule: "duplicate_node_id";
      message: string;
      nodeId: string;
    }
  | {
      kind: "loop_invalid";
      rule: "invalid_condition_edge";
      message: string;
      edgeId: string;
    };
