/**
 * Escalate-and-commit on stall (#916): replaces the hard-kill behavior of
 * the no-progress (#914) and action-repetition (#915) budgets with a softer
 * multi-stage response — nudge the agent to re-plan, then (if it stays
 * stalled) escalate to a tool-aware "finalize now" instruction, then
 * terminate the run only after the agent has had a bounded window to commit
 * its work and/or leave a stuck-report comment.
 *
 * This module is pure (no sandbox/DB/network access) so the state machine is
 * trivially unit-testable in isolation from the executor loop.
 */

export type StallTrigger = "git_stale" | "repetition" | "token_fuse";

/**
 * Thrown when a stalled background-agent run (no-progress git-delta budget,
 * #914, or action-repetition / cycle detection, #915) was nudged to
 * re-plan, escalated to a tool-aware finalize instruction, and still did not
 * recover within the finalize window (#916). Distinct from
 * BackgroundAgentTurnBudgetExceededError (executor.ts): any work the agent
 * committed, pushed, or commented during its nudge/finalize turns is
 * preserved, not discarded — this is a soft "escalate and commit" outcome,
 * not a hard kill.
 */
export class BackgroundAgentStalledError extends Error {
  constructor(
    readonly trigger: StallTrigger,
    readonly capability: WrapUpCapability,
    readonly staleTurns: number,
    readonly nudgeIssued: boolean = true,
  ) {
    super(`Background agent stalled (${trigger}) after escalation.`);
    this.name = "BackgroundAgentStalledError";
  }
}

/**
 * Which wrap-up instruction applies to a run, derived from the agent's
 * enabled GitHub action tools (#896 follow-up, moved here from executor.ts
 * so both the turn-budget note and the stall-escalation finalize note share
 * a single source of truth). A reviewer/comment-only or read-only agent
 * must never be told to push or open a pull request — it has no such tool.
 */
export type WrapUpCapability = "push_or_pr" | "comment_only" | "read_only";

export type GithubActionTogglesForCapability = {
  openPullRequest: boolean;
  push: boolean;
  commentOnPrOrIssue: boolean;
};

export function resolveWrapUpCapability(
  toggles: GithubActionTogglesForCapability,
): WrapUpCapability {
  if (toggles.openPullRequest || toggles.push) {
    return "push_or_pr";
  }
  if (toggles.commentOnPrOrIssue) {
    return "comment_only";
  }
  return "read_only";
}

type Stage = "running" | "nudged" | "escalating";

export type StallEscalationAction =
  | "continue"
  | "nudge"
  | "escalate"
  | "finalize"
  | "terminate";

export type StallEscalationResult = {
  action: StallEscalationAction;
  stage: Stage;
  trigger: StallTrigger | null;
};

export type StallEscalationObservation = {
  stalled: boolean;
  trigger: StallTrigger | null;
};

/**
 * Creates the stall-escalation state machine.
 *
 * - `graceTurns`: consecutive stalled turns tolerated AFTER the first nudge
 *   before escalating to the finalize instruction.
 * - `finalizeTurns`: turns given to the agent, once escalated, to commit,
 *   push, and/or post a stuck-report comment before the run is terminated.
 *
 * Both are STARTING VALUES to tune from real background_agent_events data —
 * see getBackgroundAgentStallGraceTurns / getBackgroundAgentStallFinalizeTurns
 * in config.ts.
 */
export function createStallEscalation(config: {
  graceTurns: number;
  finalizeTurns: number;
}): {
  observe(input: StallEscalationObservation): StallEscalationResult;
  forceEscalate(nextTrigger: StallTrigger): void;
} {
  let stage: Stage = "running";
  let turnsInStage = 0;
  let trigger: StallTrigger | null = null;

  /**
   * Jump straight to the escalating stage, skipping the nudge and grace
   * window. Used by the token-fuse backstop (#917): a runaway-cost breach is
   * not a "maybe re-plan" situation — the agent is told to finalize
   * immediately, then the normal finalize-turns countdown terminates the run.
   */
  function forceEscalate(nextTrigger: StallTrigger): void {
    stage = "escalating";
    turnsInStage = 0;
    trigger = nextTrigger;
  }

  function observe(input: StallEscalationObservation): StallEscalationResult {
    if (stage === "escalating") {
      // Escalating ignores the stalled/trigger input entirely — once the
      // agent has been told to finalize, the countdown to termination runs
      // regardless of whether the git tree or tool calls "recover".
      turnsInStage += 1;
      if (turnsInStage >= config.finalizeTurns) {
        return { action: "terminate", stage, trigger };
      }
      return { action: "finalize", stage, trigger };
    }

    if (stage === "nudged") {
      if (!input.stalled) {
        stage = "running";
        turnsInStage = 0;
        trigger = null;
        return { action: "continue", stage, trigger: null };
      }
      turnsInStage += 1;
      if (turnsInStage >= config.graceTurns) {
        stage = "escalating";
        turnsInStage = 0;
        return { action: "escalate", stage, trigger };
      }
      return { action: "continue", stage, trigger };
    }

    // stage === "running"
    if (input.stalled) {
      stage = "nudged";
      turnsInStage = 0;
      trigger = input.trigger;
      return { action: "nudge", stage, trigger };
    }
    return { action: "continue", stage, trigger: null };
  }

  return { observe, forceEscalate };
}

/**
 * Ephemeral, one-shot re-plan nudge appended to the message history sent to
 * the agent for the turn immediately following a first-detected stall.
 * Never persisted into canonical history (mirrors buildTurnBudgetNote's
 * contract in executor.ts).
 */
export function buildReplanNudgeNote(): string {
  return (
    "You appear to be stuck making progress. Stop and re-plan: try a " +
    "different approach than what you have been doing, or narrow the " +
    "scope of what you are attempting."
  );
}

/**
 * Tool-aware finalize instruction issued once a stall has been escalated
 * (after the grace window). Asks the agent to commit/push and/or comment
 * using only the GitHub actions it actually has enabled, and to leave a
 * three-part stuck-report: what it attempted, where it got stuck, and what
 * decision is needed from a human.
 */
export function buildStallFinalizeInstruction(
  capability: WrapUpCapability,
  trigger: StallTrigger,
): string {
  const stuckReport =
    "Then report: (1) what you attempted, (2) where you got stuck, and " +
    "(3) what decision you need from a human to proceed.";

  if (capability === "push_or_pr") {
    return (
      `You have made no further progress (${trigger}). Commit and push ` +
      "your changes now, then open the pull request (or update the " +
      `existing one) with the progress made so far. ${stuckReport}`
    );
  }

  if (capability === "comment_only") {
    return (
      `You have made no further progress (${trigger}). Post a comment now ` +
      `summarizing the current state — do not start new work. ${stuckReport}`
    );
  }

  return (
    `You have made no further progress (${trigger}). Stop and summarize ` +
    `your current state now using the tools available to you. ${stuckReport}`
  );
}
