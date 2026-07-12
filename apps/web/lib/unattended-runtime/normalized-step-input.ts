import { z } from "zod";
import type { ResolvedAgentLoopExecutionDefinition } from "@/lib/agent-loops/execution-snapshot";
import type { ResolvedBackgroundAgentExecutionDefinition } from "@/lib/background-agents/execution-snapshot";

const MAX_DYNAMIC_BYTES = 65_536;
const MAX_DYNAMIC_DEPTH = 12;
const MAX_CONTAINER_ENTRIES = 200;
const MAX_TOOL_ENTRIES = 50;

const forbiddenStructuralKeys = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "bearertoken",
  "callback",
  "credential",
  "credentials",
  "password",
  "providerconfig",
  "rawpayload",
  "rawwebhook",
  "resolvedtool",
  "resolvedtools",
  "sandbox",
  "sandboxstate",
  "secret",
  "session",
  "token",
  "transcript",
]);

function normalizedStructuralKey(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isForbiddenStructuralKey(value: string): boolean {
  const normalized = normalizedStructuralKey(value);
  return [...forbiddenStructuralKeys].some((key) => normalized.includes(key));
}

function safePath(path: Array<string | number>): Array<string | number> {
  return path.map((part) =>
    typeof part === "string" &&
    (part.length > 128 || isForbiddenStructuralKey(part))
      ? "[redacted]"
      : part,
  );
}

function safeDynamicPath(path: Array<string | number>): Array<string | number> {
  return path.map((part) => (typeof part === "string" ? "[field]" : part));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type JsonValidationResult =
  | { ok: true }
  | { ok: false; code: string; path: Array<string | number> };

function validateSafeJson(
  value: unknown,
  options: {
    requireObject?: boolean;
    maxBytes?: number;
  } = {},
): JsonValidationResult {
  const seen = new Set<object>();

  function visit(
    current: unknown,
    path: Array<string | number>,
    depth: number,
  ): JsonValidationResult {
    if (depth > MAX_DYNAMIC_DEPTH) {
      return { ok: false, code: "max_depth", path };
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return { ok: true };
    }
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? { ok: true }
        : { ok: false, code: "non_finite_number", path };
    }
    if (typeof current !== "object") {
      return { ok: false, code: "non_json_value", path };
    }
    if (seen.has(current)) {
      return { ok: false, code: "cyclic_value", path };
    }
    if (!Array.isArray(current) && !isPlainObject(current)) {
      return { ok: false, code: "runtime_object", path };
    }

    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > MAX_CONTAINER_ENTRIES) {
        return { ok: false, code: "max_entries", path };
      }
      for (const [index, item] of current.entries()) {
        const result = visit(item, [...path, index], depth + 1);
        if (!result.ok) return result;
      }
    } else {
      const entries = Object.entries(current);
      if (entries.length > MAX_CONTAINER_ENTRIES) {
        return { ok: false, code: "max_entries", path };
      }
      for (const [key, item] of entries) {
        const nextPath = [...path, key];
        if (isForbiddenStructuralKey(key)) {
          return { ok: false, code: "forbidden_key", path: nextPath };
        }
        const result = visit(item, nextPath, depth + 1);
        if (!result.ok) return result;
      }
    }
    seen.delete(current);
    return { ok: true };
  }

  if (options.requireObject && !isPlainObject(value)) {
    return { ok: false, code: "object_required", path: [] };
  }
  const result = visit(value, [], 0);
  if (!result.ok) return result;
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      (options.maxBytes ?? MAX_DYNAMIC_BYTES)
    ) {
      return { ok: false, code: "max_bytes", path: [] };
    }
  } catch {
    return { ok: false, code: "non_json_value", path: [] };
  }
  return { ok: true };
}

function cloneAndFreezeSafeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => cloneAndFreezeSafeJson(item)),
    ) as T;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      cloneAndFreezeSafeJson(item),
    ]);
    return Object.freeze(Object.fromEntries(entries)) as T;
  }
  return value;
}

const nullableId = z.string().min(1).max(256).nullable();
const id = z.string().min(1).max(256);
const nullableRepositoryValue = z.string().max(1024).nullable();

const frozenProvenanceSchema = z
  .object({
    snapshotSource: z.literal("frozen"),
    definitionVersion: z.literal(1),
    definitionHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const legacyProvenanceSchema = z
  .object({
    snapshotSource: z.literal("legacy_live_fallback"),
    definitionVersion: z.null(),
    definitionHash: z.null(),
  })
  .strict();

const provenanceSchema = z.discriminatedUnion("snapshotSource", [
  frozenProvenanceSchema,
  legacyProvenanceSchema,
]);

const repositorySchema = z
  .object({
    owner: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    ref: nullableRepositoryValue,
    sha: z.string().max(128).nullable(),
    branch: nullableRepositoryValue,
    defaultBranch: nullableRepositoryValue,
  })
  .strict();

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

const declaredPermissionsSchema = z
  .object({ github: githubPermissionsSchema.optional() })
  .strict();

const toolNameSchema = z.string().min(1).max(128);
const toolNamesSchema = z.array(toolNameSchema).max(MAX_TOOL_ENTRIES);

const githubActionsSchema = z
  .object({
    open_pull_request: z.boolean(),
    comment_on_pr_or_issue: z.boolean(),
    approve_pull_request: z.boolean(),
    request_changes: z.boolean(),
    merge_pull_request: z.boolean(),
    push: z.boolean(),
    delete_branch: z.boolean(),
  })
  .strict();

const scopedRepositorySchema = z
  .object({
    owner: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
  })
  .strict();

const writeScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("this_repo") }).strict(),
  z.object({ mode: z.literal("all_repos") }).strict(),
  z
    .object({
      mode: z.literal("specific_repos"),
      repos: z.array(scopedRepositorySchema).max(MAX_TOOL_ENTRIES),
    })
    .strict(),
]);

const triggerSummarySchema = z
  .object({
    title: z.string().max(4096).nullable(),
    url: z.string().url().max(2048).nullable(),
    actor: z.string().max(4096).nullable(),
    action: z.string().max(4096).nullable(),
    environment: z.string().max(4096).nullable(),
    severity: z.string().max(4096).nullable(),
    message: z.string().max(8192).nullable(),
  })
  .strict();

const triggerSchema = z
  .object({
    kind: z.string().min(1).max(128),
    ref: nullableRepositoryValue,
    sha: z.string().max(128).nullable(),
    branch: nullableRepositoryValue,
    prNumber: z.number().int().positive().nullable(),
    issueNumber: z.number().int().positive().nullable(),
    deploymentUrl: z.string().url().max(2048).nullable(),
    summary: triggerSummarySchema,
  })
  .strict();

const safeJsonValueSchema = z
  .custom<unknown>(
    (value) => validateSafeJson(value, { maxBytes: MAX_DYNAMIC_BYTES }).ok,
  )
  .transform((value) => cloneAndFreezeSafeJson(value));

const safePromptContextSchema = z
  .custom<Record<string, unknown>>(
    (value) =>
      validateSafeJson(value, {
        requireObject: true,
        maxBytes: MAX_DYNAMIC_BYTES,
      }).ok,
  )
  .transform((value) => cloneAndFreezeSafeJson(value));

const backgroundIdentitySchema = z
  .object({
    runId: id,
    userId: id,
    definitionId: id,
    triggerId: nullableId,
    requestId: nullableId,
    workflowRunId: nullableId,
  })
  .strict();

const loopIdentitySchema = z
  .object({
    runId: id,
    userId: id,
    definitionId: id,
    stepRunId: id,
    nodeId: id,
    attempt: z.number().int().positive(),
    requestId: nullableId,
    workflowRunId: nullableId,
  })
  .strict();

const gatewayModelSchema = z
  .object({ route: z.literal("gateway"), modelId: z.string().min(1).max(256) })
  .strict();

const userProfileModelSchema = z
  .object({
    route: z.literal("user"),
    modelId: z.string().min(1).max(256),
    inferenceProfileId: id,
    provider: z.enum(["anthropic", "openai-compatible"]),
    baseUrl: z.string().url().max(2048).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === "openai-compatible" && !value.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "OpenAI-compatible inference routes require a base URL.",
      });
    }
  });

const backgroundModelSchema = z.discriminatedUnion("route", [
  gatewayModelSchema,
  userProfileModelSchema,
]);

const backgroundRequestedPolicySchema = z
  .object({
    declaredPermissions: declaredPermissionsSchema,
    builtinToolNames: toolNamesSchema.nullable(),
    composioToolkitSlugs: toolNamesSchema,
    github: z
      .object({
        kind: z.literal("background_actions"),
        actions: githubActionsSchema,
        writeScope: writeScopeSchema,
        requireCiGreenForMerge: z.boolean(),
      })
      .strict(),
  })
  .strict();

const loopRequestedPolicySchema = z
  .object({
    declaredPermissions: declaredPermissionsSchema,
    builtinToolNames: toolNamesSchema.nullable(),
    composioToolkitSlugs: toolNamesSchema,
    github: z.object({ kind: z.literal("loop_step_commit") }).strict(),
  })
  .strict();

const backgroundVerificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("command"), command: z.string().min(1) }).strict(),
]);

const loopVerificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("command"), command: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("structured_output"),
      schema: safeJsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("command_and_structured_output"),
      command: z.string().min(1),
      schema: safeJsonValueSchema,
    })
    .strict(),
]);

const backgroundSandboxSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("background_agent"),
    executionKind: z.literal("background_sandbox"),
    identity: backgroundIdentitySchema,
    provenance: provenanceSchema,
    repository: repositorySchema,
    prompt: z
      .object({ definitionName: z.string(), instructions: z.string() })
      .strict(),
    trigger: triggerSchema,
    model: backgroundModelSchema,
    requestedPolicy: backgroundRequestedPolicySchema,
    verification: backgroundVerificationSchema,
    output: z.object({ kind: z.literal("agent_summary") }).strict(),
    workspace: z
      .object({
        policy: z.literal("persistent_resume"),
        sandboxName: id,
        initialCheckout: z
          .object({
            ref: z.string().min(1).max(1024),
            source: z.enum([
              "event_ref",
              "event_branch",
              "live_default_branch",
            ]),
          })
          .strict(),
        createIfMissing: z.literal(true),
        resume: z.literal(true),
      })
      .strict(),
  })
  .strict();

const backgroundLearningsSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("background_agent"),
    executionKind: z.literal("background_builtin_learnings"),
    identity: backgroundIdentitySchema,
    provenance: provenanceSchema,
    repository: repositorySchema,
    prompt: z
      .object({ definitionName: z.string(), instructions: z.string() })
      .strict(),
    trigger: triggerSchema,
    requestedPolicy: z
      .object({ kind: z.literal("builtin_pr_review_learnings") })
      .strict(),
    output: z.object({ kind: z.literal("agent_summary") }).strict(),
    workspace: z.object({ policy: z.literal("none") }).strict(),
  })
  .strict();

const loopStepSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("agent_loop_step"),
    executionKind: z.literal("loop_agent_step"),
    identity: loopIdentitySchema,
    provenance: provenanceSchema,
    repository: repositorySchema,
    prompt: z
      .object({
        instructions: z.string(),
        context: safePromptContextSchema,
        watchdogHint: z.string().max(4096).nullable(),
      })
      .strict(),
    model: z.object({ route: z.literal("runtime_default") }).strict(),
    requestedPolicy: loopRequestedPolicySchema,
    verification: loopVerificationSchema,
    budgets: z
      .object({
        timeoutMs: z.number().int().positive(),
        maxTurns: z.number().int().positive(),
      })
      .strict(),
    output: z
      .object({
        kind: z.literal("json_file"),
        path: z.literal("/tmp/loop-step-output.json"),
        schema: safeJsonValueSchema.nullable(),
        maxBytes: z.literal(65_536),
        requiredBranch: z.literal(true),
      })
      .strict(),
    workspace: z
      .object({
        policy: z.literal("disposable_step"),
        sandboxName: id,
        initialCheckout: z
          .object({
            ref: z.string().min(1).max(1024),
            source: z.enum(["context_branch", "live_default_branch"]),
          })
          .strict(),
        disposeAfterStep: z.literal(true),
        persistent: z.literal(false),
        resume: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const normalizedUnattendedStepInputV1Schema = z.discriminatedUnion(
  "executionKind",
  [backgroundSandboxSchema, backgroundLearningsSchema, loopStepSchema],
);

export type NormalizedUnattendedStepInputV1 = z.infer<
  typeof normalizedUnattendedStepInputV1Schema
>;

export type NormalizedUnattendedInputErrorKind =
  | "normalized_input_invalid"
  | "normalized_input_version_unsupported"
  | "normalized_input_policy_invalid";

export type SafeNormalizedInputIssue = {
  code: string;
  path: Array<string | number>;
};

export class NormalizedUnattendedInputError extends Error {
  constructor(
    readonly errorKind: NormalizedUnattendedInputErrorKind,
    readonly issues: SafeNormalizedInputIssue[],
  ) {
    super("Normalized unattended input failed validation.");
    this.name = "NormalizedUnattendedInputError";
  }

  toJSON(): {
    errorKind: NormalizedUnattendedInputErrorKind;
    issues: SafeNormalizedInputIssue[];
  } {
    return { errorKind: this.errorKind, issues: this.issues };
  }
}

function safeIssues(error: z.ZodError): SafeNormalizedInputIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: safePath(
      issue.path.map((part) =>
        typeof part === "symbol" ? (part.description ?? "symbol") : part,
      ),
    ),
  }));
}

function invalidDynamicValue(result: JsonValidationResult): never {
  throw new NormalizedUnattendedInputError("normalized_input_invalid", [
    {
      code: result.ok ? "invalid_dynamic_value" : result.code,
      path: result.ok ? [] : safeDynamicPath(result.path),
    },
  ]);
}

function invalidPolicy(path: Array<string | number>, code: string): never {
  throw new NormalizedUnattendedInputError("normalized_input_policy_invalid", [
    { code, path: safePath(path) },
  ]);
}

export function parseNormalizedUnattendedStepInputV1(
  value: unknown,
): NormalizedUnattendedStepInputV1 {
  const parsed = normalizedUnattendedStepInputV1Schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const version = isPlainObject(value) ? value.version : undefined;
  throw new NormalizedUnattendedInputError(
    version !== undefined && version !== 1
      ? "normalized_input_version_unsupported"
      : "normalized_input_invalid",
    safeIssues(parsed.error),
  );
}

function nullableValue(value: string | null | undefined): string | null {
  return value ?? null;
}

function normalizedSet(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function normalizeIdentity<T extends Record<string, unknown>>(identity: T): T {
  return {
    ...identity,
    requestId: nullableValue(identity.requestId as string | null | undefined),
    workflowRunId: nullableValue(
      identity.workflowRunId as string | null | undefined,
    ),
  };
}

function normalizeRepository(repository: {
  owner: string;
  name: string;
  ref?: string | null;
  sha?: string | null;
  branch?: string | null;
  defaultBranch?: string | null;
}) {
  return {
    owner: repository.owner,
    name: repository.name,
    ref: nullableValue(repository.ref),
    sha: nullableValue(repository.sha),
    branch: nullableValue(repository.branch),
    defaultBranch: nullableValue(repository.defaultBranch),
  };
}

function normalizeTrigger(trigger: {
  kind: string;
  ref?: string | null;
  sha?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  issueNumber?: number | null;
  deploymentUrl?: string | null;
  summary?: Partial<z.infer<typeof triggerSummarySchema>>;
}) {
  const summary = trigger.summary ?? {};
  return {
    kind: trigger.kind,
    ref: nullableValue(trigger.ref),
    sha: nullableValue(trigger.sha),
    branch: nullableValue(trigger.branch),
    prNumber: trigger.prNumber ?? null,
    issueNumber: trigger.issueNumber ?? null,
    deploymentUrl: nullableValue(trigger.deploymentUrl),
    summary: {
      title: nullableValue(summary.title),
      url: nullableValue(summary.url),
      actor: nullableValue(summary.actor),
      action: nullableValue(summary.action),
      environment: nullableValue(summary.environment),
      severity: nullableValue(summary.severity),
      message: nullableValue(summary.message),
    },
  };
}

type BackgroundIdentityInput = Omit<
  z.input<typeof backgroundIdentitySchema>,
  "definitionId"
>;

type LoopIdentityInput = Omit<
  z.input<typeof loopIdentitySchema>,
  "definitionId"
>;

type RepositoryIntentInput = {
  ref?: string | null;
  sha?: string | null;
  branch?: string | null;
  defaultBranch?: string | null;
};

function resolvedProvenance(
  resolved:
    | ResolvedBackgroundAgentExecutionDefinition
    | ResolvedAgentLoopExecutionDefinition,
) {
  return {
    snapshotSource: resolved.snapshotSource,
    definitionVersion: resolved.definitionVersion,
    definitionHash: resolved.definitionHash,
  };
}

function resolvedRepository(
  repository: { owner: string; name: string },
  intent: RepositoryIntentInput,
) {
  return normalizeRepository({
    owner: repository.owner,
    name: repository.name,
    ref: intent.ref,
    sha: intent.sha,
    branch: intent.branch,
    defaultBranch: intent.defaultBranch,
  });
}

function hasGitHubPermissions(
  permissions: z.input<typeof declaredPermissionsSchema> | undefined,
): permissions is z.input<typeof declaredPermissionsSchema> {
  return Object.keys(permissions?.github ?? {}).length > 0;
}

export function buildNormalizedBackgroundSandboxInput(input: {
  resolvedDefinition: ResolvedBackgroundAgentExecutionDefinition;
  identity: BackgroundIdentityInput;
  repositoryIntent: RepositoryIntentInput;
  trigger: Parameters<typeof normalizeTrigger>[0];
  workspace: {
    sandboxName: string;
    initialCheckout: z.input<
      typeof backgroundSandboxSchema
    >["workspace"]["initialCheckout"];
  };
}): Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "background_sandbox" }
> {
  const definition = input.resolvedDefinition.definition;
  if (definition.source.builtinKind !== null) {
    invalidPolicy(
      ["resolvedDefinition", "definition", "source", "builtinKind"],
      "execution_kind_mismatch",
    );
  }
  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "background_agent",
    executionKind: "background_sandbox",
    identity: {
      ...normalizeIdentity(input.identity),
      definitionId: definition.source.definitionId,
      triggerId: nullableValue(input.identity.triggerId),
    },
    provenance: resolvedProvenance(input.resolvedDefinition),
    repository: resolvedRepository(
      definition.repository,
      input.repositoryIntent,
    ),
    prompt: {
      definitionName: definition.source.name,
      instructions: definition.instructions,
    },
    trigger: normalizeTrigger(input.trigger),
    model: definition.inference,
    requestedPolicy: {
      declaredPermissions: definition.permissions,
      builtinToolNames:
        definition.builtinToolNames === null
          ? null
          : normalizedSet(definition.builtinToolNames),
      composioToolkitSlugs: normalizedSet(definition.composioToolkitSlugs),
      github: {
        kind: "background_actions",
        actions: definition.githubActions,
        writeScope: definition.writeScope,
        requireCiGreenForMerge: definition.requireCiGreenForMerge,
      },
    },
    verification: definition.checkCommand?.trim()
      ? { kind: "command", command: definition.checkCommand.trim() }
      : { kind: "none" },
    output: { kind: "agent_summary" },
    workspace: {
      policy: "persistent_resume",
      sandboxName: input.workspace.sandboxName,
      initialCheckout: input.workspace.initialCheckout,
      createIfMissing: true,
      resume: true,
    },
  }) as Extract<
    NormalizedUnattendedStepInputV1,
    { executionKind: "background_sandbox" }
  >;
}

export function buildNormalizedBackgroundLearningsInput(input: {
  resolvedDefinition: ResolvedBackgroundAgentExecutionDefinition;
  identity: BackgroundIdentityInput;
  repositoryIntent: RepositoryIntentInput;
  trigger: Parameters<typeof normalizeTrigger>[0];
}): Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "background_builtin_learnings" }
> {
  const definition = input.resolvedDefinition.definition;
  if (definition.source.builtinKind !== "pr_review_learnings") {
    invalidPolicy(
      ["resolvedDefinition", "definition", "source", "builtinKind"],
      "execution_kind_mismatch",
    );
  }
  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "background_agent",
    executionKind: "background_builtin_learnings",
    identity: {
      ...normalizeIdentity(input.identity),
      definitionId: definition.source.definitionId,
      triggerId: nullableValue(input.identity.triggerId),
    },
    provenance: resolvedProvenance(input.resolvedDefinition),
    repository: resolvedRepository(
      definition.repository,
      input.repositoryIntent,
    ),
    prompt: {
      definitionName: definition.source.name,
      instructions: definition.instructions,
    },
    trigger: normalizeTrigger(input.trigger),
    requestedPolicy: { kind: "builtin_pr_review_learnings" },
    output: { kind: "agent_summary" },
    workspace: { policy: "none" },
  }) as Extract<
    NormalizedUnattendedStepInputV1,
    { executionKind: "background_builtin_learnings" }
  >;
}

export function buildNormalizedLoopStepInput(input: {
  resolvedDefinition: ResolvedAgentLoopExecutionDefinition;
  identity: LoopIdentityInput;
  repositoryIntent: RepositoryIntentInput;
  promptContext: Record<string, unknown>;
  watchdogHint?: string | null;
  workspace: {
    sandboxName: string;
    initialCheckout: z.input<
      typeof loopStepSchema
    >["workspace"]["initialCheckout"];
  };
}): Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "loop_agent_step" }
> {
  const definition = input.resolvedDefinition.definition;
  const node = definition.definition.nodes.find(
    (candidate) => candidate.id === input.identity.nodeId,
  );
  if (!node || node.kind !== "agent_step") {
    invalidPolicy(["identity", "nodeId"], "agent_step_node_missing");
  }
  const contextResult = validateSafeJson(input.promptContext, {
    requireObject: true,
    maxBytes: MAX_DYNAMIC_BYTES,
  });
  if (!contextResult.ok) invalidDynamicValue(contextResult);
  if (node.outputSchema !== undefined) {
    const schemaResult = validateSafeJson(node.outputSchema, {
      maxBytes: MAX_DYNAMIC_BYTES,
    });
    if (!schemaResult.ok) invalidDynamicValue(schemaResult);
  }
  const hasCommand = Boolean(node.checkCommand?.trim());
  const hasSchema = node.outputSchema !== undefined;
  const verification = hasCommand
    ? hasSchema
      ? {
          kind: "command_and_structured_output" as const,
          command: node.checkCommand?.trim() ?? "",
          schema: node.outputSchema,
        }
      : {
          kind: "command" as const,
          command: node.checkCommand?.trim() ?? "",
        }
    : hasSchema
      ? {
          kind: "structured_output" as const,
          schema: node.outputSchema,
        }
      : { kind: "none" as const };

  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "agent_loop_step",
    executionKind: "loop_agent_step",
    identity: normalizeIdentity({
      ...input.identity,
      definitionId: definition.source.definitionId,
    }),
    provenance: resolvedProvenance(input.resolvedDefinition),
    repository: resolvedRepository(
      definition.repository,
      input.repositoryIntent,
    ),
    prompt: {
      instructions: node.instructions ?? "",
      context: input.promptContext,
      watchdogHint: nullableValue(input.watchdogHint),
    },
    model: { route: "runtime_default" },
    requestedPolicy: {
      declaredPermissions: hasGitHubPermissions(node.permissions)
        ? node.permissions
        : definition.permissions,
      builtinToolNames:
        node.builtinToolNames == null
          ? null
          : normalizedSet(node.builtinToolNames),
      composioToolkitSlugs: normalizedSet(node.composioToolkitSlugs ?? []),
      github: { kind: "loop_step_commit" },
    },
    verification,
    budgets: {
      timeoutMs: definition.guardrails.stepTimeoutMs,
      maxTurns: definition.guardrails.maxAgentTurnsPerStep,
    },
    output: {
      kind: "json_file",
      path: "/tmp/loop-step-output.json",
      schema: node.outputSchema ?? null,
      maxBytes: 65_536,
      requiredBranch: true,
    },
    workspace: {
      policy: "disposable_step",
      sandboxName: input.workspace.sandboxName,
      initialCheckout: input.workspace.initialCheckout,
      disposeAfterStep: true,
      persistent: false,
      resume: false,
    },
  }) as Extract<
    NormalizedUnattendedStepInputV1,
    { executionKind: "loop_agent_step" }
  >;
}
