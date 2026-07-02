/**
 * Shared agent spec logic — payload builder, form state, types, and helpers.
 *
 * Extracted from apps/web/app/settings/background-agents-form.ts so the
 * repo-dashboard creation flow can reuse the same semantics.
 * The settings form still imports from background-agents-form.ts which
 * re-exports from here.
 */
import { validateSchedule } from "./schedule-presets";

/**
 * Per-action GitHub automation toggles (#745/#747). Mirrors
 * `BackgroundAgentGithubActions` (lib/db/schema.ts) and `githubActionsSchema`
 * (types.ts) — kept as an independent client-safe type here since schema.ts
 * imports server-only Drizzle table definitions.
 */
export type GithubActions = {
  open_pull_request?: boolean;
  comment_on_pr_or_issue?: boolean;
  approve_pull_request?: boolean;
  request_changes?: boolean;
  merge_pull_request?: boolean;
  push?: boolean;
  delete_branch?: boolean;
};

export const defaultGithubActions: GithubActions = {
  open_pull_request: true,
  comment_on_pr_or_issue: true,
};

/**
 * Which repositories a background agent's write actions may target,
 * independent of the trigger-binding repoOwner/repoName pair.
 */
export type WriteScope = {
  mode: "this_repo" | "all_repos" | "specific_repos";
  repos?: Array<{ owner: string; name: string }>;
};

export const defaultWriteScope: WriteScope = { mode: "this_repo" };

export type TriggerKind =
  | "github.pull_request"
  | "github.pull_request_review"
  | "github.deployment_status"
  | "github.issue"
  | "github.check_suite"
  | "schedule.cron"
  | "webhook.error";

export type TriggerConditions = {
  actions?: string[];
  branches?: string[];
  labels?: string[];
  environments?: string[];
  severities?: string[];
  actors?: string[];
  ignoreActors?: string[];
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

export type BackgroundAgent = {
  id: string;
  name: string;
  description: string | null;
  status: "enabled" | "disabled";
  repoOwner: string;
  repoName: string;
  instructions: string;
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
    };
  };
  /** Composio toolkit slugs this agent is authorized to use. */
  composioToolkitSlugs?: string[];
  /** Per-action GitHub automation toggles (#745). Defaults when unset. */
  githubActions?: GithubActions;
  /** Write-scope for this agent's write actions. Defaults when unset. */
  writeScope?: WriteScope;
  /** Whether merge_pull_request requires CI green. Defaults to true when unset. */
  requireCiGreenForMerge?: boolean;
  /** Explicit model selection (gateway id or user-profile: selection). Null/unset = default model. */
  modelId?: string | null;
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
  conditionActors: string;
  conditionIgnoreActors: string;
  instructions: string;
  checkCommand: string;
  enabled: boolean;
  permissionContents: GitHubAccessLevel;
  permissionPullRequests: GitHubAccessLevel;
  /** Composio toolkit slugs selected for this agent. */
  composioToolkitSlugs: string[];
  /** Per-action GitHub automation toggles (#745). Optional for callers that
   * construct a bare FormState literal; buildAgentPayload/buildFormFromAgent
   * apply defaultGithubActions when omitted. */
  githubActions?: GithubActions;
  /** Write-scope for this agent's write actions. Optional; defaults to
   * defaultWriteScope when omitted. */
  writeScope?: WriteScope;
  /** Whether merge_pull_request requires CI green. Optional; defaults to
   * true when omitted. */
  requireCiGreenForMerge?: boolean;
  /** Explicit model selection. Optional; defaults to null (inherit default
   * model) when omitted. */
  modelId?: string | null;
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
  conditionActors: "",
  conditionIgnoreActors: "",
  instructions: "",
  checkCommand: "",
  enabled: false,
  permissionContents: "read",
  permissionPullRequests: "read",
  composioToolkitSlugs: [],
  githubActions: { ...defaultGithubActions },
  writeScope: { ...defaultWriteScope },
  requireCiGreenForMerge: true,
  modelId: null,
};

export const triggerLabels: Record<TriggerKind, string> = {
  "github.pull_request": "A pull request changes",
  "github.pull_request_review": "A pull request is reviewed",
  "github.deployment_status": "A deployment finishes",
  "github.issue": "An issue is opened",
  "github.check_suite": "CI checks finish (check_suite)",
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
  const actors = splitConditionList(form.conditionActors);
  const ignoreActors = splitConditionList(form.conditionIgnoreActors);

  // For deployment_status triggers, the normalizer sets event.action = deployment
  // state ("success", "failure", etc.) and never sets event.severity. Route the
  // "Statuses" UI field (conditionSeverities) into conditions.actions so the
  // matcher's conditions.actions check against event.action actually fires.
  if (form.triggerKind === "github.deployment_status") {
    return {
      ...(severities ? { actions: severities } : {}),
      ...(environments ? { environments } : {}),
      ...(actors ? { actors } : {}),
      ...(ignoreActors ? { ignoreActors } : {}),
    };
  }

  // check_suite: the normalizer maps conclusion -> event.action, so the
  // "Statuses" UI field (conditionSeverities) is routed into conditions.actions
  // the same way deployment_status is.
  if (form.triggerKind === "github.check_suite") {
    return {
      ...(severities ? { actions: severities } : {}),
      ...(branches ? { branches } : {}),
      ...(actors ? { actors } : {}),
      ...(ignoreActors ? { ignoreActors } : {}),
    };
  }

  return {
    ...(actions ? { actions } : {}),
    ...(branches ? { branches } : {}),
    ...(labels ? { labels } : {}),
    ...(environments ? { environments } : {}),
    ...(severities ? { severities } : {}),
    ...(actors ? { actors } : {}),
    ...(ignoreActors ? { ignoreActors } : {}),
  };
}

/**
 * Whether any of the given GitHub action toggles requires write access to
 * contents + pull_requests. Mirrors the executor's own derivation
 * (hasAnyWriteAction in executor.ts, #745/#756) — comment_on_pr_or_issue is
 * NOT a write action; the other six are.
 */
function hasAnyWriteAction(actions: GithubActions | undefined): boolean {
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

export function buildAgentPayload(form: FormState) {
  const conditions = buildConditions(form);
  const githubActions = form.githubActions ?? { ...defaultGithubActions };
  const writeScope = form.writeScope ?? { ...defaultWriteScope };
  const requireCiGreenForMerge = form.requireCiGreenForMerge ?? true;
  const modelId = form.modelId ?? null;

  // An enabled write action (push/merge/delete_branch/open_pr/approve/
  // request_changes) is non-functional without write access, so floor
  // contents + pull_requests to "write" regardless of the calling surface
  // (the settings form has no permission controls and would otherwise send
  // read/read). Report-only agents (comment-only or no actions) keep the
  // user's chosen access so least-privilege selections are preserved. This
  // mirrors the executor's own derivation (#747/#748).
  const requiresWrite = hasAnyWriteAction(githubActions);
  const contents = requiresWrite ? "write" : form.permissionContents;
  const pullRequests = requiresWrite ? "write" : form.permissionPullRequests;
  return {
    name: form.name,
    repoOwner: form.repoOwner,
    repoName: form.repoName,
    status: form.enabled ? "enabled" : "disabled",
    instructions: form.instructions,
    checkCommand: form.checkCommand || null,
    permissions: {
      github: {
        contents,
        pullRequests,
        issues: "read",
        deployments: "read",
        statuses: "read",
        checks: "read",
      },
    },
    composioToolkitSlugs: form.composioToolkitSlugs,
    githubActions,
    writeScope,
    requireCiGreenForMerge,
    modelId,
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
  | "statuses"
  | "actors"
  | "ignoreActors";

/**
 * Returns the Set of condition fields valid for the given trigger kind.
 * Fields not in the returned set are dead noise for that trigger and should
 * be hidden in the UI and reset when the trigger kind changes.
 *
 * "statuses" maps to `conditionSeverities` in FormState — the UI label is
 * trigger-dependent (see conditionFieldLabel).
 *
 * "actors"/"ignoreActors" (#749) are available on every GitHub event trigger
 * kind (including check_suite) — they gate on event.actor (sender.login) and
 * are the loop-safety backstop for chained agents.
 */
export function fieldsForTrigger(kind: TriggerKind): Set<ConditionField> {
  switch (kind) {
    case "github.pull_request":
      return new Set<ConditionField>([
        "actions",
        "branches",
        "labels",
        "actors",
        "ignoreActors",
      ]);
    case "github.pull_request_review":
      // actions: submitted; statuses: approved|changes_requested|commented
      return new Set<ConditionField>([
        "actions",
        "statuses",
        "actors",
        "ignoreActors",
      ]);
    case "github.issue":
      return new Set<ConditionField>([
        "actions",
        "labels",
        "actors",
        "ignoreActors",
      ]);
    case "github.deployment_status":
      return new Set<ConditionField>([
        "environments",
        "statuses",
        "actors",
        "ignoreActors",
      ]);
    case "github.check_suite":
      // statuses maps to the check_suite conclusion (success|failure|...)
      return new Set<ConditionField>([
        "branches",
        "statuses",
        "actors",
        "ignoreActors",
      ]);
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
 * - github.check_suite: "Conclusion" (matches check_suite conclusion like success/failure)
 * - webhook.error: "Severity" (matches severity on the webhook payload)
 */
export function conditionFieldLabel(
  field: ConditionField,
  triggerKind: TriggerKind,
): string {
  if (field === "statuses") {
    if (triggerKind === "github.deployment_status") return "Deployment state";
    if (triggerKind === "github.check_suite") return "Conclusion";
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
    case "actors":
      return "Only these actors";
    case "ignoreActors":
      return "Ignore these actors";
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

  // For deployment_status/check_suite triggers, the status was stored in
  // conditions.actions (see buildConditions). Restore it into
  // conditionSeverities so the UI shows the value in the "Statuses" field
  // where the user originally entered it.
  const statusDrivenByActions =
    triggerKind === "github.deployment_status" ||
    triggerKind === "github.check_suite";
  const conditionSeverities = statusDrivenByActions
    ? joinConditionList(conditions.actions)
    : joinConditionList(conditions.severities);

  // For deployment_status/check_suite, conditionActions is driven by
  // conditionSeverities, so leave it empty to avoid showing the same value
  // in two fields.
  const conditionActions = statusDrivenByActions
    ? ""
    : joinConditionList(conditions.actions);

  // Edit mode must reflect what was actually saved, not re-derive GitHub
  // access from githubActions. That keeps downgraded agents from silently
  // re-escalating when reopened.
  const savedGh = agent.permissions?.github;
  const permissionContents: GitHubAccessLevel = savedGh?.contents ?? "read";
  const permissionPullRequests: GitHubAccessLevel =
    savedGh?.pullRequests ?? "read";

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
    conditionActors: joinConditionList(conditions.actors),
    conditionIgnoreActors: joinConditionList(conditions.ignoreActors),
    instructions: agent.instructions,
    checkCommand: agent.checkCommand ?? "",
    enabled: agent.status === "enabled",
    permissionContents,
    permissionPullRequests,
    composioToolkitSlugs: agent.composioToolkitSlugs ?? [],
    githubActions: agent.githubActions ?? { ...defaultGithubActions },
    writeScope: agent.writeScope ?? { ...defaultWriteScope },
    requireCiGreenForMerge: agent.requireCiGreenForMerge ?? true,
    modelId: agent.modelId ?? null,
  };
}
