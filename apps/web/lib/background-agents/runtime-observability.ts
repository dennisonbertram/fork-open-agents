import type { ExecResult } from "@open-agents/sandbox";

const MAX_OUTPUT_CHARS = 4000;

export type BackgroundCommandObservation = {
  command: string;
  status: "passed" | "failed";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export function compactBackgroundCommandOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_OUTPUT_CHARS) {
    return trimmed;
  }

  return trimmed.slice(-MAX_OUTPUT_CHARS);
}

export function buildBackgroundCommandObservation(params: {
  command: string;
  startedAt: Date;
  finishedAt: Date;
  result: ExecResult;
}): BackgroundCommandObservation {
  return {
    command: params.command,
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
