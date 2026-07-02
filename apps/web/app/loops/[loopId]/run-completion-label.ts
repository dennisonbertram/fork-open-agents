/**
 * run-completion-label.ts — "completed-with-failures honesty" (#767).
 *
 * A run whose store status is "completed" can still have failed step runs
 * (e.g. a failure-tolerant chain that reached END anyway). Showing a clean
 * green "Completed" for that run is dishonest — this returns the amber
 * label text to use instead, or null when the plain "Completed" pill is
 * accurate (zero failed steps, or the run isn't completed at all).
 */

export function getRunCompletionLabel(params: {
  status: string;
  failedStepCount: number;
}): string | null {
  if (params.status !== "completed" || params.failedStepCount <= 0) {
    return null;
  }
  const noun = params.failedStepCount === 1 ? "step" : "steps";
  return `Completed — ${params.failedStepCount} ${noun} failed`;
}
