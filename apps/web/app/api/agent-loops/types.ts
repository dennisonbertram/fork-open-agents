/**
 * Agent Loops API — response types (M1-08)
 *
 * Exported from one colocated module so the M1-09 UI can import them and
 * shape drift becomes a compile error.
 *
 * These types are the public contract for clients; do not remove or rename
 * fields without a corresponding UI update.
 */

import type {
  AgentLoop,
  AgentLoopEvent,
  AgentLoopRun,
  AgentLoopStepRun,
  AgentLoopWatchdogRun,
  BackgroundAgentTrigger,
} from "@/lib/db/schema";
import type { LoopValidationError } from "@/lib/agent-loops/types";

// ── Error shapes ──────────────────────────────────────────────────────────────

/** Standard error response for all agent-loop API routes. */
export type AgentLoopErrorResponse = {
  errorKind: string;
  message: string;
  errors?: LoopValidationError[];
};

// ── Loop CRUD ─────────────────────────────────────────────────────────────────

export type CreateAgentLoopResponse = {
  loop: AgentLoop;
};

export type ListAgentLoopsResponse = {
  loops: AgentLoop[];
};

/** Trigger summary returned alongside the loop detail. */
export type LoopTriggerSummary = Pick<
  BackgroundAgentTrigger,
  "id" | "kind" | "status" | "conditions" | "schedule" | "createdAt"
>;

export type GetAgentLoopResponse = {
  loop: AgentLoop;
  triggers: LoopTriggerSummary[];
};

export type UpdateAgentLoopResponse = {
  loop: AgentLoop;
};

// ── Run management ────────────────────────────────────────────────────────────

export type StartAgentLoopRunResponse = {
  /** The run id that was created or is already active. */
  runId: string;
  /** Whether the run was newly created (true) or already existed (false). */
  created: boolean;
};

/**
 * 502 response shape when the initial workflow dispatch throws (issue #763 —
 * "no false success"). The run row has already been marked `failed` with
 * `errorKind: "dispatch_failed"`; the client must not treat this as a
 * successful start.
 */
export type StartAgentLoopRunDispatchFailedResponse = {
  success: false;
  errorKind: "dispatch_failed";
  message: string;
  runId: string;
};

/**
 * Run row extended with `failedStepCount` (#767) — the number of failed
 * step runs for that run, from a single grouped store query. Used by the
 * runs list and run-detail header to render "Completed — N step(s) failed"
 * honestly instead of a clean green for a completed-with-failures run.
 */
export type AgentLoopRunWithFailedStepCount = AgentLoopRun & {
  failedStepCount: number;
};

export type ListAgentLoopRunsResponse = {
  runs: AgentLoopRunWithFailedStepCount[];
};

// ── Run detail (poll target) ──────────────────────────────────────────────────

/** Minimal loop summary embedded in the run-detail response. */
export type RunLoopSummary = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  guardrails: AgentLoop["guardrails"];
};

/**
 * GET /api/agent-loop-runs/[runId] response.
 *
 * This is the single poll target for the M1-09 run page.
 * It contains everything the UI needs to render the run timeline:
 *   - run: full run row (status, counters, timestamps)
 *   - loop: minimal summary (name, repo, guardrails)
 *   - steps: ordered step runs (timeline)
 *   - events: recent events (capped at 200)
 *   - watchdogRuns: watchdog decisions ordered by createdAt asc (M3-02-B)
 */
export type GetAgentLoopRunDetailResponse = {
  run: AgentLoopRun;
  loop: RunLoopSummary;
  steps: AgentLoopStepRun[];
  events: AgentLoopEvent[];
  watchdogRuns: AgentLoopWatchdogRun[];
};

// ── Control plane ─────────────────────────────────────────────────────────────

/**
 * Response shape for pause/cancel/resume/retry control routes.
 *
 * The success case is `{ success: true }` (200). resume and retry can also
 * fail with a typed dispatch failure (issue #763 — "no false success") when
 * the state transition succeeded but the workflow dispatch itself threw:
 * the route returns 502 with `{ success: false, errorKind: "dispatch_failed" }`
 * instead of silently reporting success. The run row is already marked
 * `failed` with `errorKind: "dispatch_failed"` in this case.
 */
export type AgentLoopRunControlResponse =
  | { success: true }
  | {
      success: false;
      errorKind: "dispatch_failed";
      message: string;
    };

// ── Readiness ─────────────────────────────────────────────────────────────────

export type AgentLoopsReadinessStatus = "ready" | "missing" | "disabled";

export type AgentLoopsReadinessCheck = {
  id: "feature_flag" | "repo_allowlist";
  label: string;
  status: AgentLoopsReadinessStatus;
  detail: string;
  missing: string[];
};

export type AgentLoopsReadinessResponse = {
  enabled: boolean;
  checks: AgentLoopsReadinessCheck[];
};
