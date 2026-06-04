/**
 * Deterministic run-summary builder for background-agent runs (#163).
 * Stub — implementation to follow after red tests are committed.
 */

export type RunSummaryArtifact = {
  kind: string;
  label: string;
  url?: string | null;
  prNumber?: number | null;
  issueNumber?: number | null;
};

export type RunSummary = {
  headline: string;
  checked: string[];
  changed: string[];
  blocked: string[];
  artifacts: RunSummaryArtifact[];
  next: string[];
};

type MinimalRun = {
  id: string;
  status: string;
  repoOwner: string;
  repoName: string;
  outputKind: string | null;
  outputUrl: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  errorKind: string | null;
  errorMessage: string | null;
};

type MinimalEvent = {
  id: string;
  eventName: string;
  status: string;
  level: string;
  summary: string | null;
  errorKind: string | null;
  payload: Record<string, unknown>;
};

type MinimalOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  prNumber: number | null;
};

type BuildRunSummaryParams = {
  run: MinimalRun;
  events: MinimalEvent[];
  outputs: MinimalOutput[];
};

/**
 * Stub — returns an empty summary. Implementation intentionally omitted so
 * tests stay RED until the green commit.
 */
export function buildRunSummary(_params: BuildRunSummaryParams): RunSummary {
  throw new Error("buildRunSummary not implemented — stub for TDD red phase");
}

export async function persistRunSummary(_params: {
  runId: string;
  agentId: string | null;
  userId: string;
  repoOwner: string;
  repoName: string;
  summary: RunSummary;
  status: string;
}): Promise<void> {
  throw new Error("persistRunSummary not implemented — stub for TDD red phase");
}
