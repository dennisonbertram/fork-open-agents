/**
 * use-run-graph-state.ts — STUB (RED phase)
 *
 * Full implementation will be added in the GREEN commit.
 * This stub exports the required types and a function that returns empty state,
 * so tests fail with behavioral failures (not import errors).
 */

import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { AgentLoopStepRun, AgentLoopRun } from "@/lib/db/schema";

export type NodeRunStatus =
  | "unvisited"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type NodeGraphState = {
  status: NodeRunStatus;
  visitCount: number;
  latestAttempt: number;
};

export type EdgeGraphState = {
  traversed: boolean;
  mostRecent: boolean;
};

export type RunMeter = {
  iterationCount: number;
  maxIterations: number;
  stepCount: number;
  maxStepsPerRun: number;
};

export type RunGraphState = {
  nodes: Record<string, NodeGraphState>;
  edges: Record<string, EdgeGraphState>;
  currentNodeId: string | null;
  meter: RunMeter;
};

export type RunGraphInput = {
  definitionSnapshot: LoopDefinition;
  steps: AgentLoopStepRun[];
  run: Pick<
    AgentLoopRun,
    "status" | "currentNodeId" | "iterationCount" | "stepCount"
  >;
  guardrails: Record<string, unknown> | null;
};

/**
 * STUB — returns empty state. Real implementation in GREEN commit.
 */
export function deriveRunGraphState(_input: RunGraphInput): RunGraphState {
  return {
    nodes: {},
    edges: {},
    currentNodeId: null,
    meter: {
      iterationCount: 0,
      maxIterations: 0,
      stepCount: 0,
      maxStepsPerRun: 0,
    },
  };
}
