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

export type ListAgentLoopRunsResponse = {
  runs: AgentLoopRun[];
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
 */
export type GetAgentLoopRunDetailResponse = {
  run: AgentLoopRun;
  loop: RunLoopSummary;
  steps: AgentLoopStepRun[];
  events: AgentLoopEvent[];
};

// ── Control plane ─────────────────────────────────────────────────────────────

export type AgentLoopRunControlResponse = {
  success: true;
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
