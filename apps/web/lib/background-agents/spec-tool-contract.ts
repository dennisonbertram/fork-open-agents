/**
 * Shared spec-tool contract for the manage_background_agent tool.
 *
 * Provides:
 * - A Zod input schema composed from the canonical create/update schemas in types.ts
 * - A pure previewBackgroundAgentSpec() function that validates, normalizes, and
 *   summarizes a background-agent draft without persisting
 * - Typed result unions for success and error cases
 * - Normalization helpers that convert agent-tool format drafts to the web-side
 *   canonical schema format
 *
 * Used by both the chat workflow closure (chat.ts) and the "Create with AI" UI
 * entry point on the repo agents dashboard.
 */
import { z } from "zod";
import {
  createBackgroundAgentSchema,
  updateBackgroundAgentSchema,
} from "./types";

// ── Input schema (composed from canonical types.ts schemas) ──────────────

export const previewBackgroundAgentSpecSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    draft: createBackgroundAgentSchema,
  }),
  z.object({
    mode: z.literal("update"),
    agentId: z.string().min(1),
    draft: updateBackgroundAgentSchema,
  }),
]);

export type PreviewBackgroundAgentSpecInput = z.input<
  typeof previewBackgroundAgentSpecSchema
>;

// ── Result types ─────────────────────────────────────────────────────────

export type PreviewOkResult = {
  ok: true;
  mode: "create" | "update";
  /** Set when mode is "update". */
  agentId?: string;
  /** The validated draft, normalized to the canonical schema shape. */
  normalized:
    | z.infer<typeof createBackgroundAgentSchema>
    | z.infer<typeof updateBackgroundAgentSchema>;
  /** Markdown summary suitable for display to the user. */
  summary: string;
  /** Human-readable summary of the trigger configuration. */
  triggerSummary: string;
  /** Non-blocking concerns (e.g. "ready_pr without write permission"). */
  warnings: string[];
};

export type PreviewErrorResult = {
  ok: false;
  mode: "create" | "update";
  errorKind: "validation_failed";
  /** One-sentence description of what went wrong. */
  message: string;
  /** Per-field validation issues for display. */
  issues: Array<{ path: string; message: string }>;
};

export type PreviewBackgroundAgentSpecResult =
  | PreviewOkResult
  | PreviewErrorResult;

// ── Summarization helpers ────────────────────────────────────────────────

function formatTriggerKind(kind: string): string {
  switch (kind) {
    case "github.pull_request":
      return "Pull request";
    case "github.pull_request_review":
      return "Pull request review";
    case "github.deployment_status":
      return "Deployment status";
    case "github.issue":
      return "Issue";
    case "schedule.cron":
      return "Schedule (cron)";
    case "webhook.error":
      return "Webhook error";
    default:
      return kind;
  }
}

function formatOutputMode(mode: string): string {
  switch (mode) {
    case "none":
      return "Report only";
    case "ready_pr":
      return "Open a pull request";
    case "comment":
      return "Leave a comment";
    case "issue":
      return "Open an issue";
    case "notification":
      return "Send a notification";
    default:
      return mode;
  }
}

type SummarizableGithubActions = {
  open_pull_request?: boolean;
  comment_on_pr_or_issue?: boolean;
  approve_pull_request?: boolean;
  request_changes?: boolean;
  merge_pull_request?: boolean;
  push?: boolean;
  delete_branch?: boolean;
};

type SummarizableWriteScope = {
  mode: "this_repo" | "all_repos" | "specific_repos";
  repos?: Array<{ owner: string; name: string }>;
};

type SummarizableDraft = {
  name?: string;
  description?: string | null;
  instructions?: string;
  outputMode?: string;
  githubActions?: SummarizableGithubActions;
  writeScope?: SummarizableWriteScope;
  modelId?: string | null;
  triggers?: Array<{
    name: string;
    kind: string;
    status?: string;
    schedule?: string | null;
    conditions?: Record<string, unknown>;
  }>;
  composioToolkitSlugs?: string[];
};

/**
 * Ordered so the summary always lists actions in the same sequence as the
 * GitHub actions panel (open PR, comment, approve, request changes, merge,
 * push, delete branch).
 */
const GITHUB_ACTION_KEYS: Array<keyof SummarizableGithubActions> = [
  "open_pull_request",
  "comment_on_pr_or_issue",
  "approve_pull_request",
  "request_changes",
  "merge_pull_request",
  "push",
  "delete_branch",
];

function summarizeEnabledActions(
  actions: SummarizableGithubActions | undefined,
): string | null {
  if (!actions) return null;
  const enabled = GITHUB_ACTION_KEYS.filter((key) => actions[key]);
  if (enabled.length === 0) return null;
  return enabled.join(", ");
}

function summarizeWriteScope(
  scope: SummarizableWriteScope | undefined,
): string | null {
  if (!scope || scope.mode === "this_repo") {
    // "this_repo" is the default — no need to call it out explicitly.
    return null;
  }
  if (scope.mode === "specific_repos") {
    const repos = (scope.repos ?? [])
      .map((r) => `${r.owner}/${r.name}`)
      .join(", ");
    return repos ? `specific_repos (${repos})` : "specific_repos";
  }
  return scope.mode;
}

function hasAnyWriteAction(
  actions: SummarizableGithubActions | undefined,
): boolean {
  if (!actions) return false;
  return Boolean(
    actions.open_pull_request ||
    actions.approve_pull_request ||
    actions.request_changes ||
    actions.merge_pull_request ||
    actions.push ||
    actions.delete_branch,
  );
}

function summarizeTrigger(draft: SummarizableDraft): string {
  const triggers = draft.triggers ?? [];
  if (triggers.length === 0) {
    return "(no trigger changes)";
  }
  return triggers
    .map((t, i) => {
      const lines = [`${i + 1}. "${t.name}" — ${formatTriggerKind(t.kind)}`];
      if (t.schedule) {
        lines.push(`   Schedule: \`${t.schedule}\``);
      }
      if (t.conditions) {
        const entries = Object.entries(t.conditions).filter(
          ([, v]) => Array.isArray(v) && v.length > 0,
        );
        if (entries.length > 0) {
          lines.push(
            `   Conditions: ${entries
              .map(([k, v]) => `${k}: [${(v as string[]).join(", ")}]`)
              .join("; ")}`,
          );
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function summarizeSpec(draft: SummarizableDraft): string {
  const parts: string[] = [];

  if (draft.name) {
    parts.push(`**Name:** ${draft.name}`);
  }
  if (draft.description) {
    parts.push(`**Description:** ${draft.description}`);
  }
  if (draft.instructions) {
    const truncated =
      draft.instructions.length > 200
        ? `${draft.instructions.slice(0, 200)}...`
        : draft.instructions;
    parts.push(`**Instructions:** ${truncated}`);
  }
  if (draft.outputMode) {
    parts.push(`**Output:** ${formatOutputMode(draft.outputMode)}`);
  }

  const actionsSummary = summarizeEnabledActions(draft.githubActions);
  if (actionsSummary) {
    parts.push(`**Actions:** ${actionsSummary}`);
  }

  const writeScopeSummary = summarizeWriteScope(draft.writeScope);
  if (writeScopeSummary) {
    parts.push(`**Write scope:** ${writeScopeSummary}`);
  }

  if (draft.modelId) {
    parts.push(`**Model:** ${draft.modelId}`);
  }

  if (draft.triggers && draft.triggers.length > 0) {
    parts.push("**Triggers:**");
    for (const t of draft.triggers) {
      const schedulePart = t.schedule ? ` (${t.schedule})` : "";
      parts.push(`  - ${t.name} — ${formatTriggerKind(t.kind)}${schedulePart}`);
    }
  }

  if (draft.composioToolkitSlugs && draft.composioToolkitSlugs.length > 0) {
    parts.push(`**Tools:** ${draft.composioToolkitSlugs.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Warns when a caller supplies the deprecated `outputMode` field with a
 * non-default value (#747/#748). outputMode no longer drives behavior —
 * githubActions does — so surface a suggestion for the equivalent toggle set
 * instead of silently ignoring the input.
 */
function legacyOutputModeWarning(outputMode: string | undefined): string[] {
  if (!outputMode || outputMode === "none") {
    return [];
  }
  const suggestion =
    outputMode === "ready_pr"
      ? "push, open_pull_request"
      : outputMode === "comment"
        ? "comment_on_pr_or_issue"
        : null;
  const suggestionText = suggestion
    ? ` Use githubActions instead — for "${outputMode}", enable: ${suggestion}.`
    : ` Use githubActions instead of outputMode ("${outputMode}").`;
  return [`The "outputMode" field is deprecated.${suggestionText}`];
}

// ── Main function ────────────────────────────────────────────────────────

/**
 * Validates, normalizes, and summarizes a background-agent draft without
 * persisting it.
 *
 * Pure function — no database access, no side effects.  Safe to call from
 * the chat workflow, a server action, or directly in tests.
 *
 * @param input - discriminated union with mode ("create" | "update") and the
 *   corresponding draft payload.
 * @returns a structured result with either the validated spec + summary or
 *   a list of validation issues.
 */
export function previewBackgroundAgentSpec(
  input: PreviewBackgroundAgentSpecInput,
): PreviewBackgroundAgentSpecResult {
  if (input.mode === "create") {
    const parsed = createBackgroundAgentSchema.safeParse(input.draft);
    if (!parsed.success) {
      return {
        ok: false,
        mode: "create",
        errorKind: "validation_failed",
        message: "The background agent draft has validation errors.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    }

    const draft = parsed.data;
    const triggerSummary = summarizeTrigger(draft);
    const summary = summarizeSpec(draft);

    const warnings: string[] = [];
    if (
      hasAnyWriteAction(draft.githubActions) &&
      draft.permissions.github?.contents !== "write"
    ) {
      warnings.push(
        "One or more enabled GitHub actions require write access to contents. Set GitHub tool permissions to write.",
      );
    }
    warnings.push(...legacyOutputModeWarning(draft.outputMode));

    return {
      ok: true,
      mode: "create",
      normalized: draft,
      summary,
      triggerSummary,
      warnings,
    };
  }

  // Update mode
  const parsed = updateBackgroundAgentSchema.safeParse(input.draft);
  if (!parsed.success) {
    return {
      ok: false,
      mode: "update",
      errorKind: "validation_failed",
      message: "The background agent update draft has validation errors.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const draft = parsed.data;
  const triggerSummary = summarizeTrigger(draft as SummarizableDraft);
  const summary = summarizeSpec(draft as SummarizableDraft);

  const warnings: string[] = [];
  if (
    hasAnyWriteAction(draft.githubActions) &&
    draft.permissions?.github?.contents !== "write"
  ) {
    warnings.push(
      "One or more enabled GitHub actions require write access to contents. Set GitHub tool permissions to write.",
    );
  }
  warnings.push(...legacyOutputModeWarning(draft.outputMode));

  return {
    ok: true,
    mode: "update",
    agentId: input.agentId,
    normalized: draft,
    summary,
    triggerSummary,
    warnings,
  };
}

// ── Normalization helpers ─────────────────────────────────────────────────

/**
 * Maps an agent-side trigger kind to the canonical web-side kind.
 * Returns null when the kind cannot be mapped.
 *
 * The agent tool uses simplified trigger labels (e.g. "pull_request.opened")
 * while the web-side schema uses fully-qualified names (e.g. "github.pull_request").
 */
export function mapAgentTriggerKind(agentKind: string): string | null {
  switch (agentKind) {
    case "schedule":
      return "schedule.cron";
    case "pull_request.opened":
      return "github.pull_request";
    case "pull_request.synchronize":
      return "github.pull_request";
    case "issues.opened":
      return "github.issue";
    case "push":
      return "github.pull_request";
    case "webhook":
      return "webhook.error";
    default:
      return null;
  }
}

/**
 * Extracts a structured conditions object from the agent-side flat conditions
 * array and the agent trigger kind.
 *
 * The agent tool emits `conditions` as a flat `string[]`.  This function
 * translates it into the web-side `TriggerConditions` shape by inferring the
 * condition field from the trigger kind.
 */
export function normalizeAgentTriggerConditions(
  agentKind: string,
  conditions: string[],
): Record<string, string[] | undefined> {
  if (conditions.length === 0) {
    return {};
  }

  switch (agentKind) {
    case "pull_request.opened":
      return {
        actions: ["opened", ...conditions.filter((c) => c !== "opened")],
      };
    case "pull_request.synchronize":
      return {
        actions: [
          "synchronize",
          ...conditions.filter((c) => c !== "synchronize"),
        ],
      };
    case "issues.opened":
      return {
        actions: ["opened", ...conditions.filter((c) => c !== "opened")],
      };
    case "push":
      return { actions: conditions };
    case "webhook":
      return { severities: conditions };
    case "schedule":
      return {};
    default:
      return { actions: conditions };
  }
}

/**
 * Normalizes a permissions object from the agent-tool format to the web-side
 * canonical format.
 *
 * The agent tool uses snake_case (`pull_requests`) while the web-side schema
 * uses camelCase (`pullRequests`).  This function handles the conversion.
 */
export function normalizeAgentPermissions(
  permissions: unknown,
): Record<string, unknown> | undefined {
  if (!permissions || typeof permissions !== "object") {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  const githubPerms = (permissions as Record<string, unknown>).github as
    | Record<string, unknown>
    | undefined;
  if (githubPerms && typeof githubPerms === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(githubPerms)) {
      // Map snake_case to camelCase
      const camelKey = key === "pull_requests" ? "pullRequests" : key;
      normalized[camelKey] = value;
    }
    result.github = normalized;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Attempts to normalize an agent-tool-provided draft into the web-side
 * canonical `CreateBackgroundAgentInput` shape.
 *
 * Handles:
 * - Trigger kind mapping (agent labels → canonical kinds)
 * - Conditions format (flat array → structured object)
 * - Permissions key format (snake_case → camelCase)
 *
 * Returns the normalized object, which the caller should then validate
 * against `createBackgroundAgentSchema`.
 */
export function normalizeAgentDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...draft };

  // Normalize triggers
  if (Array.isArray(draft.triggers)) {
    result.triggers = draft.triggers.map((trigger: Record<string, unknown>) => {
      const normalized: Record<string, unknown> = { ...trigger };

      // Map trigger kind
      if (typeof trigger.kind === "string") {
        const mapped = mapAgentTriggerKind(trigger.kind);
        if (mapped) {
          normalized.kind = mapped;
        }
      }

      // Map conditions
      if (
        Array.isArray(trigger.conditions) &&
        typeof trigger.kind === "string"
      ) {
        normalized.conditions = normalizeAgentTriggerConditions(
          trigger.kind,
          trigger.conditions as string[],
        );
      }

      return normalized;
    });
  }

  // Normalize permissions (snake_case → camelCase)
  if (draft.permissions) {
    result.permissions = normalizeAgentPermissions(
      draft.permissions as Record<string, unknown>,
    );
  }

  return result;
}
