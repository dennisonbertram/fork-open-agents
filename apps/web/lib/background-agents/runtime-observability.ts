import type { ExecResult } from "@open-agents/sandbox";
import { createHash } from "node:crypto";

const MAX_OUTPUT_CHARS = 4000;

export type BackgroundCommandObservation = {
  commandLabel: BackgroundCommandLabel;
  commandHash: string;
  status: "passed" | "failed";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type BackgroundCommandLabel =
  | "git_context"
  | "required_check"
  | "working_branch_setup";

export function compactBackgroundCommandOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_OUTPUT_CHARS) {
    return trimmed;
  }

  return trimmed.slice(-MAX_OUTPUT_CHARS);
}

export function buildBackgroundCommandObservation(params: {
  command: string;
  commandLabel: BackgroundCommandLabel;
  startedAt: Date;
  finishedAt: Date;
  result: ExecResult;
}): BackgroundCommandObservation {
  return {
    commandLabel: params.commandLabel,
    commandHash: createHash("sha256").update(params.command).digest("hex"),
    status: params.result.success ? "passed" : "failed",
    exitCode: params.result.exitCode,
    durationMs: Math.max(
      0,
      params.finishedAt.getTime() - params.startedAt.getTime(),
    ),
    stdout: compactBackgroundCommandOutput(params.result.stdout),
    stderr: compactBackgroundCommandOutput(params.result.stderr),
    truncated: params.result.truncated,
  };
}
