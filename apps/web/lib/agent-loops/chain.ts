/**
 * Agent Loops — chain.ts (M1-06) — STUB
 *
 * This file exports the chain functions that will be implemented.
 * Tests import this module — currently all exports throw "not implemented".
 */

import "server-only";

import type { LoopGuardrails } from "./types";

export type RunAgentLoopStepParams = {
  stepRunId: string;
  workflowRunId: string;
};

export type ResolvedGuardrails = {
  maxStepsPerRun: number;
  maxIterations: number;
  maxRunDurationMs: number;
};

export async function runAgentLoopStep(
  _params: RunAgentLoopStepParams,
): Promise<void> {
  throw new Error("not implemented");
}

export async function advanceLoopRun(_params: {
  stepRunId: string;
  workflowRunId: string;
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
}): Promise<void> {
  throw new Error("not implemented");
}

export function resolveGuardrails(
  _userGuardrails: Partial<LoopGuardrails> | null | undefined,
): ResolvedGuardrails {
  throw new Error("not implemented");
}

export async function pauseLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("not implemented");
}

export async function cancelLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("not implemented");
}

export async function resumeLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("not implemented");
}

export async function retryCurrentStep(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("not implemented");
}
