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
