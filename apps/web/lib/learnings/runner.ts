import type { NormalizedBackgroundTriggerEvent } from "../background-agents/types";
import type { LearningsStore } from "./types";

export type RunLearningsExtractionParams = {
  event: NormalizedBackgroundTriggerEvent;
  userId: string;
  installationId: number;
  backgroundAgentRunId: string;
  octokit: unknown;
  generate: (prompt: string) => Promise<unknown>;
  store: LearningsStore;
  recordEvent: (params: unknown) => Promise<void>;
};

export type RunLearningsExtractionResult = {
  candidatesExtracted: number;
  accepted: number;
  merged: number;
  rejected: number;
  errorKind?: string;
};

export async function runLearningsExtraction(
  _params: RunLearningsExtractionParams,
): Promise<RunLearningsExtractionResult> {
  throw new Error("runLearningsExtraction not implemented");
}
