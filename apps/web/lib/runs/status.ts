import type {
  RunAttentionReason,
  RunHealth,
  RunOutcome,
  RunSource,
  RunState,
} from "./types";

export const DEFAULT_RUN_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface NormalizedRunStatus {
  state: RunState;
  outcome: RunOutcome;
  health: RunHealth;
  attentionReasons: RunAttentionReason[];
}

export interface NormalizeRunStatusInput {
  source: RunSource;
  nativeStatus: string;
  isStale?: boolean;
  failedStepCount?: number;
}

const WAITING_STATUSES = new Set([
  "approval_pending",
  "awaiting_input",
  "paused",
  "waiting",
  "waiting_on_user",
]);

function activeStatus(
  state: "queued" | "running",
  isStale: boolean,
): NormalizedRunStatus {
  return {
    state,
    outcome: null,
    health: isStale ? "needs_attention" : "ok",
    attentionReasons: isStale ? ["stale"] : [],
  };
}

function terminalStatus(
  outcome: Exclude<RunOutcome, null | "unknown">,
): NormalizedRunStatus {
  if (outcome === "failed") {
    return {
      state: "finished",
      outcome,
      health: "needs_attention",
      attentionReasons: ["failed"],
    };
  }

  if (outcome === "cancelled") {
    return {
      state: "finished",
      outcome,
      health: "warning",
      attentionReasons: ["cancelled"],
    };
  }

  return {
    state: "finished",
    outcome,
    health: "ok",
    attentionReasons: [],
  };
}

export function normalizeRunStatus(
  input: NormalizeRunStatusInput,
): NormalizedRunStatus {
  const nativeStatus = input.nativeStatus.trim().toLowerCase();

  if (nativeStatus === "queued") {
    return activeStatus("queued", input.isStale === true);
  }

  if (nativeStatus === "running") {
    return activeStatus("running", input.isStale === true);
  }

  if (WAITING_STATUSES.has(nativeStatus)) {
    return {
      state: "waiting",
      outcome: null,
      health: "warning",
      attentionReasons: ["waiting_on_user"],
    };
  }

  if (nativeStatus === "blocked") {
    return {
      state: "waiting",
      outcome: null,
      health: "needs_attention",
      attentionReasons: ["blocked"],
    };
  }

  if (nativeStatus === "stalled") {
    return {
      state: "waiting",
      outcome: null,
      health: "needs_attention",
      attentionReasons: ["stalled"],
    };
  }

  // #1241: workflowRuns.status widened with four deliberate-stop values
  // (no_progress_fuse, no_sandbox_step_cap, max_steps, repeated_tool_failure)
  // that used to all be persisted as "failed". Keep treating them the same
  // way here so a chat_workflow run doesn't silently fall through to
  // "unknown" the moment the writer starts persisting the more specific
  // value — get_session's `lastRunOutcome` is where the finer distinction is
  // surfaced instead.
  if (
    nativeStatus === "failed" ||
    nativeStatus === "no_progress_fuse" ||
    nativeStatus === "no_sandbox_step_cap" ||
    nativeStatus === "max_steps" ||
    nativeStatus === "repeated_tool_failure"
  ) {
    return terminalStatus("failed");
  }

  if (nativeStatus === "cancelled" || nativeStatus === "aborted") {
    return terminalStatus("cancelled");
  }

  if (nativeStatus === "skipped") {
    return terminalStatus("skipped");
  }

  const isExplicitSuccess =
    (input.source === "chat_workflow" && nativeStatus === "completed") ||
    (input.source === "background_agent" && nativeStatus === "succeeded") ||
    (input.source === "agent_loop" && nativeStatus === "completed");

  if (isExplicitSuccess) {
    if (input.source === "agent_loop" && (input.failedStepCount ?? 0) > 0) {
      return {
        state: "finished",
        outcome: "succeeded",
        health: "warning",
        attentionReasons: ["failed_steps"],
      };
    }

    return terminalStatus("succeeded");
  }

  return {
    state: "unknown",
    outcome: "unknown",
    health: "unknown",
    attentionReasons: ["unknown_status"],
  };
}
