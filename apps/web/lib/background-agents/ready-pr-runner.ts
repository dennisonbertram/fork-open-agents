import "server-only";

import {
  getStagedDiff,
  hasUncommittedChanges,
  stageAll,
  type ExecResult,
  type Sandbox,
} from "@open-agents/sandbox";
import { withScopedInstallationOctokit } from "@/lib/github/app";
import { buildCoAuthor, createCommit } from "@/lib/github/commit";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import { openPullRequest } from "@/lib/github/pulls";
import { getGitHubAppUserToken } from "@/lib/github/token";
import {
  buildBackgroundPullRequestBody,
  buildBackgroundPullRequestTitle,
} from "./ready-pr";
import { buildBackgroundCommandObservation } from "./runtime-observability";
import type { BackgroundAgentTriggerKind } from "./types";

/**
 * Extracted, tool-callable ready-PR commit+PR logic (#740 STEP-5).
 *
 * Previously this lived inline in apps/web/lib/background-agents/executor.ts
 * as createReadyPullRequestOutput/prepareReadyPullRequestBranch, run only as
 * post-hoc executor logic AFTER the mutation agent's turn. It now lives here
 * so it can be called from BOTH:
 *   - executor.ts (temporarily, until STEP-9 removes the post-hoc call), and
 *   - the github_open_pull_request tool (apps/web/lib/github/background-agent-tools.ts),
 *     which calls it mid-turn when the model decides the work is ready.
 *
 * The internal commit-then-PR sequence is preserved byte-for-byte from the
 * original createReadyPullRequestOutput: hasUncommittedChanges guard ->
 * stageAll -> getStagedDiff -> buildCoAuthor -> buildCommitIntentFromSandbox
 * -> withScopedInstallationOctokit({contents:'write'}, createCommit) ->
 * getGitHubAppUserToken -> openPullRequest.
 */

// ── Recording callbacks ───────────────────────────────────────────────────────
//
// Deliberately structurally compatible with (but not imported from)
// apps/web/lib/github/background-agent-tools.ts's BackgroundAgentGitHubEventInput
// / BackgroundAgentGitHubOutputInput — importing that module here would
// create a lib/background-agents -> lib/github -> lib/background-agents
// import cycle, since background-agent-tools.ts imports performReadyPullRequest
// from this file. Callers (executor.ts, background-agent-tools.ts) pre-bind
// run/agent/user/workflow attribution into these closures.

export type ReadyPrRecordEventInput = {
  eventName: string;
  status:
    | "started"
    | "running"
    | "succeeded"
    | "failed"
    | "blocked"
    | "skipped"
    | "info";
  summary?: string | null;
  payload?: Record<string, unknown>;
};

export type ReadyPrRecordOutputInput = {
  kind: "ready_pr";
  status: "skipped" | "created" | "failed";
  url?: string | null;
  prNumber?: number | null;
  payload?: Record<string, unknown>;
};

type RecordReadyPrEvent = (event: ReadyPrRecordEventInput) => Promise<void>;
type RecordReadyPrOutput = (output: ReadyPrRecordOutputInput) => Promise<void>;

// ── Local observed-command helper ─────────────────────────────────────────────
//
// Mirrors executor.ts's private execObservedCommand (records `${eventName}.started`
// then `${eventName}.completed` with a buildBackgroundCommandObservation payload
// on completion), but reports through the injected recordEvent callback instead
// of calling recordBackgroundAgentEvent directly — so branch preparation keeps
// identical event shape/payload whether invoked from executor.ts or the tool.

async function execObservedCommand(params: {
  sandbox: Sandbox;
  recordEvent: RecordReadyPrEvent;
  eventName: string;
  command: string;
  timeoutMs: number;
}): Promise<ExecResult> {
  await params.recordEvent({
    eventName: `${params.eventName}.started`,
    status: "running",
    summary: `Running ${params.command}`,
    payload: {
      command: params.command,
      timeoutMs: params.timeoutMs,
    },
  });

  const startedAt = new Date();
  const result = await params.sandbox.exec(
    params.command,
    params.sandbox.workingDirectory,
    params.timeoutMs,
  );
  const finishedAt = new Date();
  const observation = buildBackgroundCommandObservation({
    command: params.command,
    startedAt,
    finishedAt,
    result,
  });

  await params.recordEvent({
    eventName: `${params.eventName}.completed`,
    status: result.success ? "succeeded" : "failed",
    summary: result.success
      ? `Command passed: ${params.command}`
      : `Command failed: ${params.command}`,
    payload: observation,
  });

  return result;
}

// ── Branch preparation ────────────────────────────────────────────────────────

export async function prepareReadyPullRequestBranch(params: {
  sandbox: Sandbox;
  branchName: string;
  recordEvent: RecordReadyPrEvent;
}): Promise<void> {
  const result = await execObservedCommand({
    sandbox: params.sandbox,
    recordEvent: params.recordEvent,
    eventName: "background-agent.git.branch",
    command: `git checkout ${params.branchName} 2>/dev/null || git checkout -b ${params.branchName}`,
    timeoutMs: 30_000,
  });

  if (!result.success) {
    throw new Error("Failed to prepare background-agent PR branch.");
  }
}

// ── App base URL resolution (moved from executor.ts; only used here) ─────────

function resolveAppBaseUrl(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL,
    process.env.VERCEL_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    const url =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    try {
      return new URL(url).origin;
    } catch {
      continue;
    }
  }

  return null;
}

// ── Commit + open PR ──────────────────────────────────────────────────────────

export type PerformReadyPullRequestParams = {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  agentName: string;
  repoOwner: string;
  repoName: string;
  branchName: string;
  baseBranch: string;
  installationId: number;
  repositoryId: number;
  /**
   * Explicit, bounded set of repo IDs the write-scoped installation token is
   * minted against — always includes repositoryId (the commit/PR target).
   * Resolved by resolveWriteScopeRepositoryIds before this function is
   * called; never omitted/unrestricted.
   */
  repositoryIds: number[];
  checkCommand?: string | null;
  triggerKind: BackgroundAgentTriggerKind;
  /** Optional overrides for the generated PR title/body (tool-callable path). */
  title?: string | null;
  body?: string | null;
  recordEvent: RecordReadyPrEvent;
  recordOutput: RecordReadyPrOutput;
};

export type PerformReadyPullRequestResult = {
  success: boolean;
  prUrl?: string;
  prNumber?: number | null;
  error?: string;
};

/**
 * Commits staged sandbox changes via a verified GitHub App commit and opens a
 * pull request. Never throws for expected failure modes (no changes, commit
 * build/API failure, missing user token, PR-open failure) — callers branch on
 * `result.success` instead of try/catch, so this is directly usable as a tool
 * execute() body. Unexpected exceptions from underlying calls still propagate.
 */
export async function performReadyPullRequest(
  params: PerformReadyPullRequestParams,
): Promise<PerformReadyPullRequestResult> {
  if (!(await hasUncommittedChanges(params.sandbox))) {
    await params.recordOutput({
      kind: "ready_pr",
      status: "skipped",
      payload: {
        reason: "no_changes",
      },
    });
    return {
      success: false,
      error: "Background agent completed without file changes.",
    };
  }

  await stageAll(params.sandbox);
  const diff = await getStagedDiff(params.sandbox);
  const commitMessage =
    diff.trim().length > 0
      ? `chore: apply ${params.agentName} background changes`
      : "chore: apply background agent changes";
  const coAuthor = await buildCoAuthor(params.userId);
  const intentResult = await buildCommitIntentFromSandbox({
    sandbox: params.sandbox,
    owner: params.repoOwner,
    repo: params.repoName,
    repositoryId: params.repositoryId,
    installationId: params.installationId,
    branch: params.branchName,
    baseBranch: params.baseBranch,
    message: commitMessage.slice(0, 72),
    ...(coAuthor ? { coAuthor } : {}),
  });

  if (!intentResult.ok) {
    return { success: false, error: intentResult.error };
  }

  await params.recordEvent({
    eventName: "background-agent.commit.started",
    status: "running",
    summary: "Creating verified GitHub App commit for background changes.",
    payload: {
      branchName: params.branchName,
      fileCount: intentResult.intent.files.length,
      repositoryIds: params.repositoryIds,
    },
  });

  const commitResult = await withScopedInstallationOctokit({
    installationId: intentResult.intent.installationId,
    repositoryIds: params.repositoryIds,
    permissions: { contents: "write" },
    operation: async (octokit) =>
      createCommit({
        octokit,
        owner: intentResult.intent.owner,
        repo: intentResult.intent.repo,
        branch: intentResult.intent.branch,
        expectedHeadSha: intentResult.intent.expectedHeadSha,
        message: intentResult.intent.message,
        files: intentResult.intent.files,
        ...(intentResult.intent.baseBranch
          ? { baseBranch: intentResult.intent.baseBranch }
          : {}),
        ...(intentResult.intent.coAuthor
          ? { coAuthor: intentResult.intent.coAuthor }
          : {}),
      }),
  });

  if (!commitResult.ok) {
    return { success: false, error: commitResult.error };
  }

  await params.recordEvent({
    eventName: "background-agent.commit.completed",
    status: "succeeded",
    summary: "Verified GitHub App commit created.",
    payload: {
      branchName: params.branchName,
      commitSha: commitResult.commitSha,
      repositoryIds: params.repositoryIds,
    },
  });

  const userToken = await getGitHubAppUserToken(params.userId);
  if (!userToken) {
    return {
      success: false,
      error: "GitHub user token is required to open a pull request.",
    };
  }

  const appBaseUrl = resolveAppBaseUrl();
  const runUrl = appBaseUrl
    ? `${appBaseUrl}/background-runs/${encodeURIComponent(params.runId)}`
    : null;
  const title = params.title?.trim()
    ? params.title.trim()
    : buildBackgroundPullRequestTitle(params.agentName);
  const body = params.body?.trim()
    ? params.body
    : buildBackgroundPullRequestBody({
        runId: params.runId,
        agentName: params.agentName,
        triggerKind: params.triggerKind,
        repoOwner: params.repoOwner,
        repoName: params.repoName,
        baseBranch: params.baseBranch,
        branchName: params.branchName,
        commitSha: commitResult.commitSha,
        checkCommand: params.checkCommand,
        runUrl,
      });
  const prResult = await openPullRequest({
    repoUrl: `https://github.com/${params.repoOwner}/${params.repoName}`,
    branchName: params.branchName,
    title,
    body,
    baseBranch: params.baseBranch,
    token: userToken,
  });

  if (!prResult.success || !prResult.prUrl) {
    return {
      success: false,
      error: prResult.error ?? "Failed to create pull request.",
    };
  }

  await params.recordOutput({
    kind: "ready_pr",
    status: "created",
    url: prResult.prUrl,
    prNumber: prResult.prNumber ?? null,
    payload: {
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      commitSha: commitResult.commitSha,
    },
  });
  await params.recordEvent({
    eventName: "background-agent.output.created",
    status: "succeeded",
    summary: `Created ready PR${prResult.prNumber ? ` #${prResult.prNumber}` : ""}.`,
    payload: {
      outputKind: "ready_pr",
      prNumber: prResult.prNumber ?? null,
      url: prResult.prUrl,
    },
  });

  return {
    success: true,
    prUrl: prResult.prUrl,
    prNumber: prResult.prNumber ?? null,
  };
}
