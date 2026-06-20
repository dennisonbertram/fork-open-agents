export type AccountWorkSource =
  | "session"
  | "chat_workflow"
  | "background_agent"
  | "agent_loop";

export type AccountSnapshotSource = AccountWorkSource | "scheduled_agents";

export type AccountWorkStatus =
  | "queued"
  | "running"
  | "waiting_on_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "scheduled";

export type AccountAttentionReason =
  | "failed"
  | "cancelled"
  | "stale"
  | "waiting_on_user"
  | "source_failed";

export type AccountSourceStatusState = "ok" | "partial" | "failed";

export interface AccountSourceStatus {
  source: AccountSnapshotSource;
  status: AccountSourceStatusState;
  itemCount: number;
  error?: string;
}

export interface AccountWorkItem {
  id: string;
  source: AccountWorkSource;
  title: string;
  status: AccountWorkStatus;
  needsAttention: boolean;
  attentionReasons: AccountAttentionReason[];
  updatedAt: string;
  createdAt?: string;
  completedAt?: string;
  repo?: {
    owner: string;
    name: string;
    branch?: string;
  };
  href?: string;
  diagnosisHref?: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AccountScheduledAgent {
  id: string;
  name: string;
  source: "background_agent" | "agent_loop";
  status: "enabled" | "disabled" | "active" | "paused";
  repo: {
    owner: string;
    name: string;
  };
  nextRunAt?: string;
  triggerKind?: string;
}

export interface AccountSnapshotResponse {
  generatedAt: string;
  window: {
    requested: string;
    hours: number;
    since: string;
  };
  sourceStatus: AccountSourceStatus[];
  needsAttention: AccountWorkItem[];
  running: AccountWorkItem[];
  recentlyCompleted: AccountWorkItem[];
  waitingOnUser: AccountWorkItem[];
  stale: AccountWorkItem[];
  scheduledAgents: AccountScheduledAgent[];
}

export type AccountDiagnosisSource = AccountWorkSource;

export type AccountDiagnosticEvidenceKind =
  | "target"
  | "timeline_event"
  | "workflow_run"
  | "workflow_input_snapshot"
  | "workflow_step"
  | "session_event"
  | "background_agent_event"
  | "background_agent_output"
  | "background_agent_tool_session"
  | "agent_loop_step"
  | "agent_loop_event"
  | "agent_loop_watchdog"
  | "managed_runtime_profile_run"
  | "sandbox_service"
  | "browser_run"
  | "workflow_goal"
  | "workflow_goal_event"
  | "verified_build_run"
  | "verified_build_event"
  | "github_pull_request"
  | "github_issue"
  | "github_action_run";

export interface AccountDiagnosticEvidence {
  id: string;
  kind: AccountDiagnosticEvidenceKind;
  title: string;
  status?: string;
  level?: "info" | "warn" | "error";
  summary?: string;
  occurredAt?: string;
  redactionStatus?: string;
  correlations?: Record<string, string | number | boolean | null>;
  metadata?: Record<string, unknown>;
}

export interface AccountDiagnosticSourceGap {
  source: string;
  reason: string;
}

export interface AccountDiagnosticSourceStatus {
  source: string;
  status: AccountSourceStatusState;
  itemCount: number;
  error?: string;
}

export interface AccountDiagnosticCorrelations {
  sessionIds: string[];
  chatIds: string[];
  workflowRunIds: string[];
  requestIds: string[];
  harnessRunIds: string[];
  sandboxNames: string[];
  serviceIds: string[];
  browserRunIds: string[];
  prNumbers: number[];
  issueNumbers: number[];
}

export interface AccountDiagnosisResponse {
  generatedAt: string;
  source: AccountDiagnosisSource;
  id: string;
  target: AccountWorkItem;
  sourceStatus: AccountDiagnosticSourceStatus[];
  project?: {
    repo?: {
      owner: string;
      name: string;
      branch?: string;
    };
    prNumber?: number;
    issueNumber?: number;
  };
  diagnosis: {
    status: AccountWorkStatus;
    needsAttention: boolean;
    attentionReasons: AccountAttentionReason[];
    summary: string;
    evidenceCounts: Record<AccountDiagnosticEvidenceKind, number>;
    sourceGaps: AccountDiagnosticSourceGap[];
  };
  correlations: AccountDiagnosticCorrelations;
  timeline: AccountDiagnosticEvidence[];
  evidence: AccountDiagnosticEvidence[];
}
