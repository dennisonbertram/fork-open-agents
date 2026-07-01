/**
 * Shared agent spec logic — payload builder, form state, types, and helpers.
 *
 * Extracted from apps/web/app/settings/background-agents-form.ts so the
 * repo-dashboard creation flow can reuse the same semantics.
 * The settings form still imports from background-agents-form.ts which
 * re-exports from here.
 */
import { DEFAULT_ON_TOOL_NAMES } from "./builtin-toolpack";
import { validateSchedule } from "./schedule-presets";

export type TriggerKind =
  | "github.pull_request"
  | "github.pull_request_review"
  | "github.deployment_status"
  | "github.issue"
  | "schedule.cron"
  | "webhook.error";

export type OutputMode =
  | "comment"
  | "ready_pr"
  | "issue"
  | "notification"
  | "none";

export type TriggerConditions = {
  actions?: string[];
  branches?: string[];
  labels?: string[];
  environments?: string[];
  severities?: string[];
};

export type BackgroundAgentTrigger = {
  id: string;
  name: string;
  kind: TriggerKind;
  status: "enabled" | "disabled";
  conditions?: TriggerConditions;
  schedule: string | null;
  webhookPublicId: string | null;
};

export type GitHubAccessLevel = "read" | "write";

/**
 * How many repos a ready_pr agent's minted write token is scoped to.
 * "this_repo" (the default) is byte-for-byte identical to pre-#736 behavior.
 * writeScopeRepos (when mode is "repo_list") holds owner/repo full names,
 * not cached numeric ids — ids are re-resolved fresh at run time.
 */
export type WriteScopeMode = "this_repo" | "all_repos" | "repo_list";

export type BackgroundAgent = {
  id: string;
  name: string;
  description: string | null;
  status: "enabled" | "disabled";
  repoOwner: string;
  repoName: string;
  instructions: string;
  outputMode: OutputMode;
  checkCommand: string | null;
  triggers: BackgroundAgentTrigger[];
  /** Saved GitHub permissions. Optional so create-flow callers stay valid. */
  permissions?: {
    github?: {
      contents?: GitHubAccessLevel;
      pullRequests?: GitHubAccessLevel;
      issues?: GitHubAccessLevel;
      deployments?: "read";
      statuses?: "read";
      checks?: "read";
      writeScopeMode?: WriteScopeMode;
      writeScopeRepos?: string[];
    };
  };
  /** Composio toolkit slugs this agent is authorized to use. */
  composioToolkitSlugs?: string[];
  /**
   * Built-in tool allowlist ("Standard toolpack"). null/undefined means the
   * default preset (all built-ins except web_fetch — see
   * DEFAULT_ON_TOOL_NAMES in builtin-toolpack.ts).
   */
  builtinToolNames?: string[] | null;
};

export type FormState = {
  name: string;
  repoOwner: string;
  repoName: string;
  triggerKind: TriggerKind;
  schedule: string;
  conditionActions: string;
  conditionBranches: string;
  conditionLabels: string;
  conditionEnvironments: string;
  conditionSeverities: string;
  instructions: string;
  outputMode: OutputMode;
  checkCommand: string;
  enabled: boolean;
  permissionContents: GitHubAccessLevel;
  permissionPullRequests: GitHubAccessLevel;
  /** Composio toolkit slugs selected for this agent. */
  composioToolkitSlugs: string[];
  /**
   * Built-in tool allowlist ("Standard toolpack"). null/undefined means
   * "use the default preset" (rendered by the Standard toolpack UI as
   * DEFAULT_ON_TOOL_NAMES, all built-ins except web_fetch). Optional so
   * existing FormState literals across the agent builder/edit flows keep
   * compiling until they're wired up to the Standard toolpack UI.
   */
  builtinToolNames?: string[] | null;
  /**
   * How many repos a ready_pr agent's write token is scoped to. Only
   * meaningful when outputMode is "ready_pr" — buildAgentPayload forces
   * "this_repo"/[] for every other outputMode so a report-only agent can
   * never carry broad write scope. Optional (defaults to "this_repo") so
   * existing FormState literals across the agent builder/edit flows keep
   * compiling until they're wired up to the write-scope selector UI.
   */
  writeScopeMode?: WriteScopeMode;
  /** owner/repo full names selected when writeScopeMode is "repo_list". */
  writeScopeRepos?: string[];
};

export const defaultForm: FormState = {
  name: "",
  repoOwner: "",
  repoName: "",
  triggerKind: "github.pull_request",
  schedule: "",
  conditionActions: "",
  conditionBranches: "",
  conditionLabels: "",
  conditionEnvironments: "",
  conditionSeverities: "",
  instructions: "",
  outputMode: "none",
  checkCommand: "",
  enabled: false,
  permissionContents: "read",
  permissionPullRequests: "read",
  composioToolkitSlugs: [],
  builtinToolNames: null,
  writeScopeMode: "this_repo",
  writeScopeRepos: [],
};

export const triggerLabels: Record<TriggerKind, string> = {
  "github.pull_request": "A pull request changes",
  "github.pull_request_review": "A pull request is reviewed",
  "github.deployment_status": "A deployment finishes",
  "github.issue": "An issue is opened",
  "schedule.cron": "On a schedule",
  "webhook.error": "An error is reported (webhook)",
};

export const flowSteps = [
  "Trigger",
  "Conditions",
  "Instructions",
  "Permissions",
  "Outputs",
  "Test",
];

export const supportedOutputModes = [
  "none",
  "ready_pr",
] as const satisfies readonly OutputMode[];

/**
 * Creates a blank FormState pre-scoped to the given repo.
 * The agent starts disabled by default.
 */
export function buildRepoScopedDefaultForm(
  repoOwner: string,
  repoName: string,
): FormState {
  return {
    ...defaultForm,
    repoOwner,
    repoName,
  };
}

function splitConditionList(value: string) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function joinConditionList(value: string[] | undefined) {
  return value?.join(", ") ?? "";
}

function buildConditions(form: FormState): TriggerConditions {
  const actions = splitConditionList(form.conditionActions);
  const branches = splitConditionList(form.conditionBranches);
  const labels = splitConditionList(form.conditionLabels);
  const environments = splitConditionList(form.conditionEnvironments);
  const severities = splitConditionList(form.conditionSeverities);

  // For deployment_status triggers, the normalizer sets event.action = deployment
  // state ("success", "failure", etc.) and never sets event.severity. Route the
  // "Statuses" UI field (conditionSeverities) into conditions.actions so the
  // matcher's conditions.actions check against event.action actually fires.
  if (form.triggerKind === "github.deployment_status") {
    return {
      ...(severities ? { actions: severities } : {}),
      ...(environments ? { environments } : {}),
    };
  }

  return {
    ...(actions ? { actions } : {}),
    ...(branches ? { branches } : {}),
    ...(labels ? { labels } : {}),
    ...(environments ? { environments } : {}),
    ...(severities ? { severities } : {}),
  };
}

export function buildAgentPayload(form: FormState) {
  const conditions = buildConditions(form);
  // Result (outputMode) is the single source of truth for GitHub write
  // access — form.permissionContents/permissionPullRequests are intentionally
  // NOT read here. Ready PR is non-functional without write access (the
  // agent must push a branch and open a PR), so it always gets write.
  // Every other output mode is read-only: there is no separate GitHub
  // Access-level control that can escalate a Report-only agent to write.
  const requiresWrite = form.outputMode === "ready_pr";
  const contents = requiresWrite ? "write" : "read";
  const pullRequests = requiresWrite ? "write" : "read";
  // Write scope (how many repos the minted write token can touch) is only
  // meaningful for ready_pr agents. Every other output mode is forced back
  // to this_repo/[] so a report-only agent can never carry broad scope,
  // mirroring the same outputMode-is-the-only-source-of-truth rule used for
  // contents/pullRequests above.
  const writeScopeMode = requiresWrite
    ? (form.writeScopeMode ?? "this_repo")
    : "this_repo";
  const writeScopeRepos = requiresWrite ? (form.writeScopeRepos ?? []) : [];
  return {
    name: form.name,
    repoOwner: form.repoOwner,
    repoName: form.repoName,
    status: form.enabled ? "enabled" : "disabled",
    instructions: form.instructions,
    outputMode: form.outputMode,
    checkCommand: form.checkCommand || null,
    permissions: {
      github: {
        contents,
        pullRequests,
        issues: "read",
        deployments: "read",
        statuses: "read",
        checks: "read",
        writeScopeMode,
        writeScopeRepos,
      },
    },
    composioToolkitSlugs: form.composioToolkitSlugs,
    // null means "use the default preset" — persist it explicitly as the
    // web_fetch-off allowlist so execution (executor.ts) always has a
    // concrete allowlist to read off the agent row.
    builtinToolNames: form.builtinToolNames ?? [...DEFAULT_ON_TOOL_NAMES],
    triggers: [
      {
        name: triggerLabels[form.triggerKind],
        kind: form.triggerKind,
        status: "enabled",
        conditions,
        schedule: form.triggerKind === "schedule.cron" ? form.schedule : null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// New pure functions — Slices 1–5
// ---------------------------------------------------------------------------

export type StepId =
  | "trigger"
  | "conditions"
  | "instructions"
  | "permissions"
  | "outputs"
  | "test";

export type ConditionField =
  | "actions"
  | "branches"
  | "labels"
  | "environments"
  | "statuses";

/**
 * Returns the Set of condition fields valid for the given trigger kind.
 * Fields not in the returned set are dead noise for that trigger and should
 * be hidden in the UI and reset when the trigger kind changes.
 *
 * "statuses" maps to `conditionSeverities` in FormState — the UI label is
 * trigger-dependent (see conditionFieldLabel).
 */
export function fieldsForTrigger(kind: TriggerKind): Set<ConditionField> {
  switch (kind) {
    case "github.pull_request":
      return new Set<ConditionField>(["actions", "branches", "labels"]);
    case "github.pull_request_review":
      // actions: submitted; statuses: approved|changes_requested|commented
      return new Set<ConditionField>(["actions", "statuses"]);
    case "github.issue":
      return new Set<ConditionField>(["actions", "labels"]);
    case "github.deployment_status":
      return new Set<ConditionField>(["environments", "statuses"]);
    case "schedule.cron":
      return new Set<ConditionField>();
    case "webhook.error":
      return new Set<ConditionField>(["statuses"]);
  }
}

/**
 * Returns the human label for a condition field in the context of a trigger.
 *
 * The "statuses" field has a trigger-dependent label:
 * - github.deployment_status: "Deployment state" (matches deployment state like success/failure)
 * - webhook.error: "Severity" (matches severity on the webhook payload)
 */
export function conditionFieldLabel(
  field: ConditionField,
  triggerKind: TriggerKind,
): string {
  if (field === "statuses") {
    if (triggerKind === "github.deployment_status") return "Deployment state";
    if (triggerKind === "webhook.error") return "Severity";
    if (triggerKind === "github.pull_request_review") return "Review state";
    return "Statuses";
  }
  switch (field) {
    case "actions":
      return "Actions";
    case "branches":
      return "Branches";
    case "labels":
      return "Labels";
    case "environments":
      return "Environments";
  }
}

/**
 * Returns a user-facing summary of what the given output mode permits.
 * Derived from the outputMode → permissions map in buildAgentPayload.
 */
export function describeOutputModePermissions(mode: OutputMode): string {
  switch (mode) {
    case "ready_pr":
      return "Read + open PRs — this agent can read your code and open pull requests. It cannot merge, push to protected branches, or modify issues.";
    default:
      return "Read-only — this agent can read your code, PRs, issues, deployments, and checks. It cannot create or modify anything.";
  }
}

/**
 * Returns the user-facing label for an output mode.
 * Centralizes the inline ternary used in background-agents-section.tsx.
 */
export function outputModeLabel(mode: OutputMode): string {
  switch (mode) {
    case "none":
      return "None";
    case "ready_pr":
      return "Ready PR";
    case "comment":
      return "Comment";
    case "issue":
      return "Issue";
    case "notification":
      return "Notification";
  }
}

/**
 * Validates whether the given form step is complete.
 * Used by the form stepper to gate "Next" navigation and the final submit button.
 */
export function isStepValid(form: FormState, stepId: StepId): boolean {
  switch (stepId) {
    case "trigger":
      return (
        form.name.trim().length > 0 &&
        form.repoOwner.trim().length > 0 &&
        form.repoName.trim().length > 0
      );
    case "conditions":
      if (form.triggerKind === "schedule.cron") {
        return validateSchedule(form.schedule).valid;
      }
      return true;
    case "instructions":
      return form.instructions.trim().length > 0;
    case "permissions":
      return true;
    case "outputs":
      return true;
    case "test":
      return (
        isStepValid(form, "trigger") &&
        isStepValid(form, "conditions") &&
        isStepValid(form, "instructions")
      );
  }
}

export function buildFormFromAgent(agent: BackgroundAgent): FormState {
  const trigger = agent.triggers[0];
  const conditions = trigger?.conditions ?? {};
  const triggerKind = trigger?.kind ?? "github.pull_request";

  // For deployment_status triggers, the status was stored in conditions.actions
  // (see buildConditions). Restore it into conditionSeverities so the UI shows
  // the value in the "Statuses" field where the user originally entered it.
  const conditionSeverities =
    triggerKind === "github.deployment_status"
      ? joinConditionList(conditions.actions)
      : joinConditionList(conditions.severities);

  // For deployment_status, conditionActions is driven by conditionSeverities, so
  // leave it empty to avoid showing the same value in two fields.
  const conditionActions =
    triggerKind === "github.deployment_status"
      ? ""
      : joinConditionList(conditions.actions);

  // Display-only: show what was actually saved for this agent. Note that
  // buildAgentPayload no longer reads these fields on save — GitHub write
  // access is derived purely from outputMode there, so a saved write value
  // shown here for a legacy "none" agent will be downgraded to read the next
  // time this form is saved.
  const savedGh = agent.permissions?.github;
  const permissionContents: GitHubAccessLevel = savedGh?.contents ?? "read";
  const permissionPullRequests: GitHubAccessLevel =
    savedGh?.pullRequests ?? "read";
  const writeScopeMode: WriteScopeMode = savedGh?.writeScopeMode ?? "this_repo";
  const writeScopeRepos = savedGh?.writeScopeRepos ?? [];

  return {
    name: agent.name,
    repoOwner: agent.repoOwner,
    repoName: agent.repoName,
    triggerKind,
    schedule: trigger?.schedule ?? "",
    conditionActions,
    conditionBranches: joinConditionList(conditions.branches),
    conditionLabels: joinConditionList(conditions.labels),
    conditionEnvironments: joinConditionList(conditions.environments),
    conditionSeverities,
    instructions: agent.instructions,
    outputMode: agent.outputMode,
    checkCommand: agent.checkCommand ?? "",
    enabled: agent.status === "enabled",
    permissionContents,
    permissionPullRequests,
    composioToolkitSlugs: agent.composioToolkitSlugs ?? [],
    builtinToolNames: agent.builtinToolNames ?? null,
    writeScopeMode,
    writeScopeRepos,
  };
}
