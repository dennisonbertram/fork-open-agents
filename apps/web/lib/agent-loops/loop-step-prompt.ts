/**
 * Agent Loops — loop step prompt builder stub
 *
 * This file is a stub that will be replaced with the full implementation (M1-05).
 */

import "server-only";

import type { AgentStepNode } from "./types";

export type BuildLoopStepPromptParams = {
  node: AgentStepNode;
  contextSlice: Record<string, unknown>;
  repo: string;
  branch: string;
};

/**
 * Builds the prompt for an agent_step node, including:
 * - node instructions
 * - serialized run-context slice
 * - output contract (write JSON to /tmp/loop-step-output.json)
 * - explicit prohibitions (no push, no PRs, no writes outside workspace)
 *
 * This is a stub — full implementation in M1-05.
 */
export function buildLoopStepPrompt(
  _params: BuildLoopStepPromptParams,
): string {
  throw new Error("not_implemented: buildLoopStepPrompt (M1-05)");
}
