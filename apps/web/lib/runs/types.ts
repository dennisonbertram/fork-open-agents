export type RunSource = "chat_workflow" | "background_agent" | "agent_loop";

export type AutomationRunSource = Exclude<RunSource, "chat_workflow">;

export type NormalizedRunId = `${RunSource}:${string}`;

export type RunState =
  | "queued"
  | "running"
  | "waiting"
  | "finished"
  | "unknown";

export type RunOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "unknown"
  | null;

export type RunHealth = "ok" | "warning" | "needs_attention" | "unknown";

export type RunAttentionReason =
  | "blocked"
  | "cancelled"
  | "failed"
  | "failed_steps"
  | "stale"
  | "stalled"
  | "unknown_status"
  | "waiting_on_user";

export interface RunRepository {
  owner: string;
  name: string;
  branch?: string;
}

export interface NormalizedRunTimestamps {
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type NormalizedRunMetadata = Record<
  string,
  string | number | boolean | null
>;

/**
 * Additive, source-independent read contract. Source storage and executors stay
 * authoritative; this shape only describes what can be stated truthfully.
 */
export interface NormalizedRun {
  id: NormalizedRunId;
  source: RunSource;
  sourceId: string;
  nativeStatus: string;
  nativeSource: string | null;
  title: string;
  state: RunState;
  outcome: RunOutcome;
  health: RunHealth;
  attentionReasons: RunAttentionReason[];
  repository: RunRepository | null;
  detailUrl: string;
  timestamps: NormalizedRunTimestamps;
  metadata: NormalizedRunMetadata;
}

export interface AutomationReference {
  source: AutomationRunSource;
  sourceId: string;
}

export type AutomationTriggerSource =
  | "github"
  | "schedule"
  | "webhook"
  | "manual"
  | "unknown";

export interface NormalizedRunTrigger {
  id: string | null;
  source: AutomationTriggerSource;
  kind: string | null;
}

export interface NormalizedRunProgress {
  currentStepId: string | null;
  completedSteps: number | null;
  totalSteps: number | null;
}

export interface NormalizedRunEvidence {
  requestId: string | null;
  workflowRunId: string | null;
  sandboxName: string | null;
  outputUrl: string | null;
}

/**
 * Automation-only extension used by the unified Runs product. Interactive chat
 * workflows intentionally remain NormalizedRun values owned by Sessions.
 */
export interface NormalizedAutomationRun extends NormalizedRun {
  source: AutomationRunSource;
  automation: AutomationReference | null;
  automationName: string;
  trigger: NormalizedRunTrigger;
  progress: NormalizedRunProgress;
  evidence: NormalizedRunEvidence;
}
