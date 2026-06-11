/**
 * Agent Loops — agent_step executor stub
 *
 * This file is a stub that will be replaced with the full implementation (M1-05).
 * All functions here throw "not_implemented" so the test suite can load and
 * fail for behavioral reasons (not import errors).
 */

import "server-only";

import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import type { AgentStepNode } from "./types";
import type { StepExecutionResult } from "./step-executor";

// ── Public API ─────────────────────────────────────────────────────────────────

export type AgentStepParams = {
  stepRunId: string;
  workflowRunId: string;
  loopRunId: string;
  node: AgentStepNode;
  loopRun: AgentLoopRun;
  loop: AgentLoop;
  startedAt: number;
};

/**
 * Executes an agent_step node: connects a fresh sandbox, runs openAgent,
 * reads the structured output JSON, optionally runs checkCommand, commits
 * produced changes, and disposes the sandbox.
 *
 * This is a stub — full implementation in M1-05.
 */
export async function executeAgentStep(
  _params: AgentStepParams,
): Promise<StepExecutionResult> {
  throw new Error("not_implemented: executeAgentStep (M1-05)");
}
