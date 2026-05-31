// POC 4b — profile runner.
//
// Executes a ManagedRuntimeProfile's setupCommands then verificationCommands
// against an environment, and produces a pass/fail report per command plus
// which expectedTools resolve on PATH. The result shape and status vocabulary
// deliberately mirror the REAL observability layer in
// `apps/web/lib/observability/managed-runtime-profile-runs.ts`:
//
//   - ManagedRuntimeCommandObservation { commandId, label, status, required,
//       exitCode, durationMs, summary, startedAt, finishedAt }
//   - status ∈ "running" | "passed" | "failed" | "skipped"
//   - a run has setupResults[] + verificationResults[] and an overall status.
//
// This POC adds a real executor (the real code only records observations; the
// sandbox supplies the executor). The executor is pluggable so we can run the
// same profiles locally or inside a clean Docker Linux image.

import type {
  ManagedRuntimeProfile,
  ManagedRuntimeProfileCommand,
} from "../profiles/types";

export type CommandResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

// An executor runs a shell command in some environment and returns its result.
// `extraPath` lets the runner prepend the profile bin dir so freshly-installed
// tools resolve within the same session.
export type Executor = (command: string) => Promise<CommandResult>;

export type CommandObservation = {
  commandId: string;
  label: string;
  status: "running" | "passed" | "failed" | "skipped";
  required: boolean;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  startedAt: string;
  finishedAt: string;
};

export type ToolResolution = { tool: string; resolved: boolean; path: string };

export type ProfileRunReport = {
  profileId: string;
  profileVersion: string;
  profileDisplayName: string;
  status: "passed" | "failed";
  setupResults: CommandObservation[];
  verificationResults: CommandObservation[];
  expectedTools: ToolResolution[];
  optionalTools: ToolResolution[];
  setupDurationMs: number;
  verificationDurationMs: number;
  totalDurationMs: number;
  summary: string;
  failureMessage: string | null;
};

// Mirrors summarizeManagedRuntimeCommandOutput in the real observability file:
// prefer stderr+stdout, trim, cap length.
function summarize(result: CommandResult): string {
  const combined = [result.stderr, result.stdout]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
  if (combined.length === 0) {
    return result.success
      ? "Command completed without output."
      : "Command failed without output.";
  }
  return combined.slice(0, 2000);
}

async function runCommand(
  executor: Executor,
  command: ManagedRuntimeProfileCommand,
): Promise<CommandObservation> {
  const required = command.required ?? true;
  const startedAt = new Date();
  const result = await executor(command.command);
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  // A required command that fails => failed. A non-required command that fails
  // is recorded but does not fail the run (mirrors required-vs-optional split).
  const status = result.success ? "passed" : "failed";

  return {
    commandId: command.id,
    label: command.label,
    status,
    required,
    exitCode: result.exitCode,
    durationMs,
    summary: summarize(result),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

async function resolveTools(
  executor: Executor,
  tools: string[],
): Promise<ToolResolution[]> {
  const resolutions: ToolResolution[] = [];
  for (const tool of tools) {
    // `command -v` is POSIX and matches how the real verification commands probe
    // PATH. We capture the resolved path for the evidence transcript.
    const result = await executor(`command -v ${tool} || true`);
    const path = result.stdout.trim();
    resolutions.push({ tool, resolved: path.length > 0, path });
  }
  return resolutions;
}

export async function runProfile(
  profile: ManagedRuntimeProfile,
  executor: Executor,
): Promise<ProfileRunReport> {
  const setupResults: CommandObservation[] = [];
  const verificationResults: CommandObservation[] = [];
  let failureMessage: string | null = null;

  const setupStart = Date.now();
  for (const command of profile.setupCommands) {
    const observation = await runCommand(executor, command);
    setupResults.push(observation);
    if (observation.status === "failed" && observation.required) {
      failureMessage = `Required setup command failed: ${command.id} (exit ${observation.exitCode})`;
      break;
    }
  }
  const setupDurationMs = Date.now() - setupStart;

  // Only run verification if setup did not hit a required failure — matches a
  // real run aborting before verification when setup cannot complete.
  const verifyStart = Date.now();
  if (!failureMessage) {
    for (const command of profile.verificationCommands) {
      const observation = await runCommand(executor, command);
      verificationResults.push(observation);
      if (observation.status === "failed" && observation.required) {
        failureMessage =
          failureMessage ??
          `Required verification command failed: ${command.id} (exit ${observation.exitCode})`;
      }
    }
  }
  const verificationDurationMs = Date.now() - verifyStart;

  const expectedTools = await resolveTools(executor, profile.expectedTools);
  const optionalTools = await resolveTools(executor, profile.optionalTools);

  // A run passes iff: no required command failed AND every expectedTool resolved.
  const unresolvedExpected = expectedTools.filter((entry) => !entry.resolved);
  if (!failureMessage && unresolvedExpected.length > 0) {
    failureMessage = `Expected tools not on PATH: ${unresolvedExpected
      .map((entry) => entry.tool)
      .join(", ")}`;
  }

  const status: "passed" | "failed" = failureMessage ? "failed" : "passed";
  const resolvedExpected = expectedTools.filter((entry) => entry.resolved).length;
  const summary = `${status.toUpperCase()} — setup ${setupResults.filter((r) => r.status === "passed").length}/${
    setupResults.length
  } ok, verify ${verificationResults.filter((r) => r.status === "passed").length}/${
    verificationResults.length
  } ok, tools ${resolvedExpected}/${expectedTools.length} present`;

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    profileDisplayName: profile.displayName,
    status,
    setupResults,
    verificationResults,
    expectedTools,
    optionalTools,
    setupDurationMs,
    verificationDurationMs,
    totalDurationMs: setupDurationMs + verificationDurationMs,
    summary,
    failureMessage,
  };
}
