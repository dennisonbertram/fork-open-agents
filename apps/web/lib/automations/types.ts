import type { NormalizedRun } from "@/lib/runs/types";

export const automationSources = ["background_agent", "agent_loop"] as const;
export type AutomationSource = (typeof automationSources)[number];

export const automationKinds = ["single_step", "multi_step"] as const;
export type AutomationKind = (typeof automationKinds)[number];

export const automationNativeStatuses = [
  "enabled",
  "disabled",
  "draft",
  "active",
  "paused",
  "archived",
] as const;
export type AutomationNativeStatus = (typeof automationNativeStatuses)[number];

export type AutomationRepository = { owner: string; name: string };

export type AutomationFilters = {
  repository?: AutomationRepository;
  kind?: AutomationKind;
  state?: AutomationNativeStatus;
};

export type AutomationListItem = {
  id: string;
  source: AutomationSource;
  sourceId: string;
  kind: AutomationKind;
  name: string;
  description: string | null;
  repository: AutomationRepository;
  nativeStatus: AutomationNativeStatus;
  operability: "active" | "inactive";
  configurationHealth: "valid" | "invalid";
  configurationErrorKind: "automation_definition_invalid" | null;
  observedRevision: {
    contractVersion: 1;
    sourceUpdatedAt: string;
  };
  stepCount: number | null;
  triggers: {
    total: number;
    enabled: number;
    kinds: string[];
    labels: string[];
    nextRunAt: string | null;
  };
  verification: {
    configuredStepCount: number | null;
    totalVerifiableSteps: number | null;
  };
  output: {
    declaredSchemaCount: number | null;
    publishingActionCount: number | null;
  };
  latestRun: NormalizedRun | null;
  detailUrl: string;
  editUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationSourceStatus = {
  source: AutomationSource;
  status: "ok" | "partial" | "disabled" | "failed";
  itemCount: number;
  invalidItemCount: number;
  errorKind:
    | "feature_disabled"
    | "source_unavailable"
    | "automation_definition_invalid"
    | null;
};

export type AutomationFacets = {
  repositories: AutomationRepository[];
  kinds: AutomationKind[];
  states: AutomationNativeStatus[];
};

export type AutomationListSnapshot = {
  automations: AutomationListItem[];
  total: number;
  sourceStatus: AutomationSourceStatus[];
  facets: AutomationFacets;
};

export type ListAutomationsResponse = AutomationListSnapshot & {
  requestId: string;
};
