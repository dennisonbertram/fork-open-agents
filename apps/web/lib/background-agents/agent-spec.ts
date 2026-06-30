/**
 * Shared agent spec logic — payload builder, form state, types, and helpers.
 *
 * Extracted from apps/web/app/settings/background-agents-form.ts so the
 * repo-dashboard creation flow can reuse the same semantics.
 * The settings form still imports from background-agents-form.ts which
 * re-exports from here.
 */
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
    };
  };
  /** Composio toolkit slugs this agent is authorized to use. */
  composioToolkitSlugs?: string[];
};

/**
 * A draft trigger for the multi-trigger editor UI.
 * Each TriggerDraft maps 1:1 to a trigger in the final payload.
 */
export type TriggerDraft = {
  id: string;
  triggerKind: TriggerKind;
  schedule: string;
  conditionActions: string;
  conditionBranches: string;
  conditionLabels: string;
  conditionEnvironments: string;
  conditionSeverities: string;
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
   * Multi-trigger drafts. When present and non-empty, buildAgentPayload emits
   * one trigger per draft instead of the scalar triggerKind/schedule/condition*
   * fields. The scalar path is preserved for back-compat.
   */
  triggers?: TriggerDraft[];
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

/**
 * Creates a blank TriggerDraft with the given deterministic id and optional kind.
 */
export function createTriggerDraft(
  id: string,
  kind: TriggerKind = "github.pull_request",
): TriggerDraft {
  return {
    id,
    triggerKind: kind,
    schedule: "",
    conditionActions: "",
    conditionBranches: "",
    conditionLabels: "",
    conditionEnvironments: "",
    conditionSeverities: "",
  };
}

function buildConditionsFromDraft(draft: TriggerDraft): TriggerConditions {
  const actions = splitConditionList(draft.conditionActions);
  const branches = splitConditionList(draft.conditionBranches);
  const labels = splitConditionList(draft.conditionLabels);
  const environments = splitConditionList(draft.conditionEnvironments);
  const severities = splitConditionList(draft.conditionSeverities);

  // Mirror the same deployment_status routing logic from buildConditions:
  // severities UI field goes into conditions.actions for deployment_status.
  if (draft.triggerKind === "github.deployment_status") {
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

/**
 * Converts an array of TriggerDraft objects into the payload triggers array
 * (one entry per draft), reusing the same condition routing as buildConditions.
 */
export function buildTriggerDraftsPayload(drafts: TriggerDraft[]) {
  return drafts.map((draft) => ({
    name: triggerLabels[draft.triggerKind],
    kind: draft.triggerKind,
    status: "enabled" as const,
    conditions: buildConditionsFromDraft(draft),
    schedule: draft.triggerKind === "schedule.cron" ? draft.schedule : null,
  }));
}

/**
 * Derives a short name from agent instructions — first ~6 words, title-cased.
 * Returns "" when instructions are blank.
 */
export function deriveAgentName(instructions: string): string {
  const trimmed = instructions.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/).slice(0, 6);
  const raw = words.join(" ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function buildAgentPayload(form: FormState) {
  // Ready PR is non-functional without write access — the agent must push a
  // branch and open a PR — so floor contents + pull_requests to "write" for
  // ready_pr regardless of the calling surface (the settings form has no
  // permission controls and would otherwise send read/read). Report-only agents
  // keep the user's chosen access so least-privilege selections are preserved.
  const requiresWrite = form.outputMode === "ready_pr";
  const contents = requiresWrite ? "write" : form.permissionContents;
  const pullRequests = requiresWrite ? "write" : form.permissionPullRequests;

  // Multi-trigger path: use drafts array when present and non-empty.
  const triggers =
    form.triggers && form.triggers.length > 0
      ? buildTriggerDraftsPayload(form.triggers)
      : (() => {
          const conditions = buildConditions(form);
          return [
            {
              name: triggerLabels[form.triggerKind],
              kind: form.triggerKind,
              status: "enabled" as const,
              conditions,
              schedule:
                form.triggerKind === "schedule.cron" ? form.schedule : null,
            },
          ];
        })();

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
      },
    },
    composioToolkitSlugs: form.composioToolkitSlugs,
    triggers,
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
 * Returns a plain-language summary of what the agent WILL do and what it
 * will NOT do, based on its output mode and GitHub access level.
 *
 * Intended for the "AND IT WILL…" output summary rendered below the Result
 * section in the spec editor.
 */
export function describeAgentOutput(args: {
  outputMode: OutputMode;
  githubAccess: "read" | "write";
}): { will: string; wont: string } {
  const { outputMode } = args;

  if (outputMode === "ready_pr") {
    return {
      will: "Open a draft pull request with its changes for you to review.",
      wont: "It will NOT merge or push directly to your default branch.",
    };
  }

  // report-only / none
  return {
    will: "Leave a written summary on the run.",
    wont: "It will NOT comment on, close, merge, edit, or push code to the repo.",
  };
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

  // Edit mode must reflect what was actually saved, not re-derive GitHub access
  // from outputMode. That keeps downgraded agents from silently re-escalating
  // when reopened.
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
    instructions: agent.instructions,
    outputMode: agent.outputMode,
    checkCommand: agent.checkCommand ?? "",
    enabled: agent.status === "enabled",
    permissionContents,
    permissionPullRequests,
    composioToolkitSlugs: agent.composioToolkitSlugs ?? [],
  };
}
