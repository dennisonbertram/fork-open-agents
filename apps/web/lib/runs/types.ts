export type RunSource = "chat_workflow" | "background_agent" | "agent_loop";

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
