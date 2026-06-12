/**
 * Agent Loops — run-controls (M1-08, route-side control plane)
 *
 * Thin stubs — implementation follows in GREEN phase.
 * These functions are called from route handlers (not from workflow bodies).
 * They intentionally do NOT carry "use step" — they are route-side concerns.
 */
import "server-only";

// Stub — GREEN phase implementation pending
export async function pauseLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("Not implemented");
}

export async function cancelLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("Not implemented");
}

export async function resumeLoopRun(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("Not implemented");
}

export async function retryCurrentStep(
  _runId: string,
  _userId: string,
): Promise<void> {
  throw new Error("Not implemented");
}
