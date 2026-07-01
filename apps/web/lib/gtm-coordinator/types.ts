export type GtmSnapshotSource =
  | "account_work"
  | "product_shipments"
  | "inbound"
  | "distribution"
  | "audience";

export type GtmItemStatus =
  | "draft"
  | "active"
  | "pending_approval"
  | "running"
  | "completed"
  | "failed"
  | "stale"
  | "waiting";

export type GtmAttentionReason =
  | "pending_approval"
  | "draft_signal"
  | "stale_experiment"
  | "source_failed"
  | "missing_source";

export type GtmSourceStatusState =
  | "healthy"
  | "partial"
  | "failed"
  | "missing"
  | "stale";

export interface GtmSourceStatus {
  source: GtmSnapshotSource;
  status: GtmSourceStatusState;
  itemCount: number;
  errorKind?: string;
  summary?: string;
}

export interface GtmBriefItem {
  id: string;
  source: GtmSnapshotSource;
  title: string;
  status: GtmItemStatus;
  needsAttention: boolean;
  attentionReasons: GtmAttentionReason[];
  priority: "high" | "medium" | "low";
  updatedAt: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  diagnosisHref: string;
}

export interface GtmNextAction {
  id: string;
  label: string;
  priority: "high" | "medium" | "low";
  requiresAuthorization: boolean;
  evidence: Array<{
    source: GtmSnapshotSource;
    id: string;
    href: string;
  }>;
}

export interface GtmBriefResponse {
  generatedAt: string;
  window: {
    requested: string;
    hours: number;
    since: string;
  };
  sourceStatus: GtmSourceStatus[];
  needsAttention: GtmBriefItem[];
  running: GtmBriefItem[];
  recentlyCompleted: GtmBriefItem[];
  waiting: GtmBriefItem[];
  stale: GtmBriefItem[];
  nextActions: GtmNextAction[];
}

export interface GtmDiagnosisResponse {
  generatedAt: string;
  source: GtmSnapshotSource;
  id: string;
  item: GtmBriefItem;
  sourceStatus: GtmSourceStatus[];
  evidence: Array<{
    id: string;
    title: string;
    status?: string;
    summary?: string;
    occurredAt?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }>;
}
