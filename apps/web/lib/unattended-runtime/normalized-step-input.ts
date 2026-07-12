import { z } from "zod";

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
        if (forbiddenStructuralKeys.has(normalizedStructuralKey(key))) {
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

const safeJsonValueSchema = z.custom<unknown>(
  (value) => validateSafeJson(value, { maxBytes: MAX_DYNAMIC_BYTES }).ok,
);

const safePromptContextSchema = z.custom<Record<string, unknown>>(
  (value) =>
    validateSafeJson(value, {
      requireObject: true,
      maxBytes: MAX_DYNAMIC_BYTES,
    }).ok,
);

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
  .strict();

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
    builtinToolNames: toolNamesSchema,
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
    path: issue.path.map((part) =>
      typeof part === "symbol" ? (part.description ?? "symbol") : part,
    ),
  }));
}

function invalidDynamicValue(result: JsonValidationResult): never {
  throw new NormalizedUnattendedInputError("normalized_input_invalid", [
    {
      code: result.ok ? "invalid_dynamic_value" : result.code,
      path: result.ok ? [] : result.path,
    },
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

type CommonBuilderInput = {
  identity: Record<string, unknown>;
  provenance: z.input<typeof provenanceSchema>;
  repository: z.input<typeof repositorySchema>;
};

type BackgroundDefinitionInput = {
  name: string;
  instructions: string;
  builtinKind: "pr_review_learnings" | null;
  inference: z.input<typeof backgroundModelSchema>;
  permissions: z.input<typeof declaredPermissionsSchema>;
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
  githubActions: z.input<typeof githubActionsSchema>;
  writeScope: z.input<typeof writeScopeSchema>;
  requireCiGreenForMerge: boolean;
  checkCommand: string | null;
};

export function buildNormalizedBackgroundSandboxInput(
  input: CommonBuilderInput & {
    identity: z.input<typeof backgroundIdentitySchema>;
    definition: BackgroundDefinitionInput;
    trigger: Parameters<typeof normalizeTrigger>[0];
    workspace: {
      sandboxName: string;
      initialCheckout: z.input<
        typeof backgroundSandboxSchema
      >["workspace"]["initialCheckout"];
    };
  },
): Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "background_sandbox" }
> {
  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "background_agent",
    executionKind: "background_sandbox",
    identity: {
      ...normalizeIdentity(input.identity),
      triggerId: nullableValue(input.identity.triggerId),
    },
    provenance: input.provenance,
    repository: normalizeRepository(input.repository),
    prompt: {
      definitionName: input.definition.name,
      instructions: input.definition.instructions,
    },
    trigger: normalizeTrigger(input.trigger),
    model: input.definition.inference,
    requestedPolicy: {
      declaredPermissions: input.definition.permissions,
      builtinToolNames:
        input.definition.builtinToolNames === null
          ? null
          : normalizedSet(input.definition.builtinToolNames),
      composioToolkitSlugs: normalizedSet(
        input.definition.composioToolkitSlugs,
      ),
      github: {
        kind: "background_actions",
        actions: input.definition.githubActions,
        writeScope: input.definition.writeScope,
        requireCiGreenForMerge: input.definition.requireCiGreenForMerge,
      },
    },
    verification: input.definition.checkCommand?.trim()
      ? { kind: "command", command: input.definition.checkCommand.trim() }
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

export function buildNormalizedBackgroundLearningsInput(
  input: CommonBuilderInput & {
    identity: z.input<typeof backgroundIdentitySchema>;
    definition: {
      name: string;
      instructions: string;
      builtinKind: "pr_review_learnings";
    };
    trigger: Parameters<typeof normalizeTrigger>[0];
  },
): Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "background_builtin_learnings" }
> {
  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "background_agent",
    executionKind: "background_builtin_learnings",
    identity: {
      ...normalizeIdentity(input.identity),
      triggerId: nullableValue(input.identity.triggerId),
    },
    provenance: input.provenance,
    repository: normalizeRepository(input.repository),
    prompt: {
      definitionName: input.definition.name,
      instructions: input.definition.instructions,
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
  identity: z.input<typeof loopIdentitySchema>;
  provenance: z.input<typeof provenanceSchema>;
  repository: z.input<typeof repositorySchema>;
  node: {
    instructions: string;
    outputSchema?: unknown;
    checkCommand?: string | null;
    permissions: z.input<typeof declaredPermissionsSchema>;
    builtinToolNames: string[];
    composioToolkitSlugs: string[];
  };
  promptContext: Record<string, unknown>;
  watchdogHint?: string | null;
  budgets: z.input<typeof loopStepSchema>["budgets"];
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
  const contextResult = validateSafeJson(input.promptContext, {
    requireObject: true,
    maxBytes: MAX_DYNAMIC_BYTES,
  });
  if (!contextResult.ok) invalidDynamicValue(contextResult);
  if (input.node.outputSchema !== undefined) {
    const schemaResult = validateSafeJson(input.node.outputSchema, {
      maxBytes: MAX_DYNAMIC_BYTES,
    });
    if (!schemaResult.ok) invalidDynamicValue(schemaResult);
  }
  const hasCommand = Boolean(input.node.checkCommand?.trim());
  const hasSchema = input.node.outputSchema !== undefined;
  const verification = hasCommand
    ? hasSchema
      ? {
          kind: "command_and_structured_output" as const,
          command: input.node.checkCommand?.trim() ?? "",
          schema: input.node.outputSchema,
        }
      : {
          kind: "command" as const,
          command: input.node.checkCommand?.trim() ?? "",
        }
    : hasSchema
      ? {
          kind: "structured_output" as const,
          schema: input.node.outputSchema,
        }
      : { kind: "none" as const };

  return parseNormalizedUnattendedStepInputV1({
    version: 1,
    source: "agent_loop_step",
    executionKind: "loop_agent_step",
    identity: normalizeIdentity(input.identity),
    provenance: input.provenance,
    repository: normalizeRepository(input.repository),
    prompt: {
      instructions: input.node.instructions,
      context: input.promptContext,
      watchdogHint: nullableValue(input.watchdogHint),
    },
    model: { route: "runtime_default" },
    requestedPolicy: {
      declaredPermissions: input.node.permissions,
      builtinToolNames: normalizedSet(input.node.builtinToolNames),
      composioToolkitSlugs: normalizedSet(input.node.composioToolkitSlugs),
      github: { kind: "loop_step_commit" },
    },
    verification,
    budgets: input.budgets,
    output: {
      kind: "json_file",
      path: "/tmp/loop-step-output.json",
      schema: input.node.outputSchema ?? null,
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
