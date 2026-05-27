type TriggerKind =
  | "github.pull_request"
  | "github.deployment_status"
  | "github.issue"
  | "schedule.cron"
  | "webhook.error";

type OutputMode = "comment" | "ready_pr" | "issue" | "notification" | "none";

type TriggerConditions = {
  actions?: string[];
  branches?: string[];
  labels?: string[];
  environments?: string[];
  severities?: string[];
};

type BackgroundAgentTrigger = {
  id: string;
  name: string;
  kind: TriggerKind;
  status: "enabled" | "disabled";
  conditions?: TriggerConditions;
  schedule: string | null;
  webhookPublicId: string | null;
};

type BackgroundAgent = {
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
};

type FormState = {
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
};

const defaultForm: FormState = {
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
};

const triggerLabels: Record<TriggerKind, string> = {
  "github.pull_request": "Pull request",
  "github.deployment_status": "Deployment status",
  "github.issue": "Issue",
  "schedule.cron": "Schedule",
  "webhook.error": "Error webhook",
};

const flowSteps = [
  "Trigger",
  "Conditions",
  "Instructions",
  "Permissions",
  "Outputs",
  "Test",
];

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
        contents: form.outputMode === "ready_pr" ? "write" : "read",
        pullRequests: form.outputMode === "ready_pr" ? "write" : "read",
        issues: "read",
        deployments: "read",
        statuses: "read",
        checks: "read",
      },
    },
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

export function buildFormFromAgent(agent: BackgroundAgent): FormState {
  const trigger = agent.triggers[0];
  const conditions = trigger?.conditions ?? {};
  return {
    name: agent.name,
    repoOwner: agent.repoOwner,
    repoName: agent.repoName,
    triggerKind: trigger?.kind ?? "github.pull_request",
    schedule: trigger?.schedule ?? "",
    conditionActions: joinConditionList(conditions.actions),
    conditionBranches: joinConditionList(conditions.branches),
    conditionLabels: joinConditionList(conditions.labels),
    conditionEnvironments: joinConditionList(conditions.environments),
    conditionSeverities: joinConditionList(conditions.severities),
    instructions: agent.instructions,
    outputMode: agent.outputMode,
    checkCommand: agent.checkCommand ?? "",
    enabled: agent.status === "enabled",
  };
}

export { defaultForm, flowSteps, triggerLabels };
export type {
  BackgroundAgent,
  BackgroundAgentTrigger,
  FormState,
  OutputMode,
  TriggerConditions,
  TriggerKind,
};
