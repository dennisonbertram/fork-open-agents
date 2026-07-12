import "server-only";

import {
  defaultModelLabel,
  gateway,
  openAgent,
  type AgentModelSelection,
  type OpenAgentCallOptions,
  sanitizeUnattendedToolCalls,
} from "@open-agents/agent";
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-agents/sandbox";
import type { ModelMessage } from "ai";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  getBackgroundAgentHardTurnCap,
  getBackgroundAgentMaxRunTokens,
  getBackgroundAgentMaxStaleTurns,
  getBackgroundAgentRepetitionThreshold,
  getBackgroundAgentStallFinalizeTurns,
  getBackgroundAgentStallGraceTurns,
  getBackgroundAgentRepoAccess,
  isBackgroundAgentsEnabled,
} from "./config";
import { createProgressBudget } from "./progress-budget";
import { detectRepetition, hashTurnToolCalls } from "./action-repetition";
import {
  BackgroundAgentStalledError,
  buildReplanNudgeNote,
  buildStallFinalizeInstruction,
  createStallEscalation,
  resolveWrapUpCapability,
  type StallTrigger,
} from "./stall-escalation";
import { createHash } from "node:crypto";
import {
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
  type ScopedInstallationToken,
} from "@/lib/github/app";
import { getGitHubUserProfile } from "@/lib/github/users";
import type {
  BackgroundAgentGithubActions,
  NewBackgroundAgentOutput,
} from "@/lib/db/schema";
import {
  defaultBackgroundAgentGithubActions,
  defaultBackgroundAgentWriteScope,
} from "@/lib/db/schema";
import {
  getBackgroundAgentRunWithAgent,
  listBackgroundAgentComposioEvents,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
  recordBackgroundAgentEvent,
  updateBackgroundAgentRunStatus,
} from "./store";
import { resolveComposioToolsForBgRun } from "./composio-tools";
import {
  resolveGitHubActionTools,
  type GitHubActionToggles,
  type BackgroundAgentWriteScope as GitHubToolsWriteScope,
} from "./github-action-tools";
import { mergeExtraTools } from "@/app/workflows/merge-extra-tools";
import { buildRunSummary, mergeEventsForSummary } from "./run-summary";
import {
  persistRunSummary,
  recordSummaryFailedEvent,
} from "./run-summary-persist";
import { buildBackgroundCommandObservation } from "./runtime-observability";
import {
  buildBackgroundAgentRunbookPrompt,
  buildBackgroundBranchName,
} from "./ready-pr";
import type { NormalizedBackgroundTriggerEvent } from "./types";
import { runLearningsExtraction } from "@/lib/learnings/runner";
import { createDbLearningsStore } from "@/lib/learnings/store";
import { generateText, Output } from "ai";
import { recordUsage } from "@/lib/db/usage";
import { extractedLearningCandidateSchema } from "@/lib/learnings/types";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";
import { resolveInferenceProfileModelSelection } from "@/lib/inference/profile-resolution";
import {
  BackgroundAgentSnapshotError,
  resolveBackgroundAgentExecutionDefinition,
  type BackgroundAgentExecutionSnapshotV1,
} from "./execution-snapshot";
import { sha256CanonicalJson } from "@/lib/execution-snapshots/canonical-json";

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_TIMEOUT_MS = 600_000;

/**
 * Thrown ONLY by the opt-in absolute hard turn ceiling (#862, enforced when
 * BACKGROUND_AGENT_MAX_TURNS is explicitly set; getBackgroundAgentHardTurnCap
 * in config.ts). As of #916, the progress-based stall path (no-progress
 * git-delta budget, #914, and action-repetition / cycle detection, #915) no
 * longer throws this error — it escalates through
 * BackgroundAgentStalledError below instead of hard-killing the run.
 */
export class BackgroundAgentTurnBudgetExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly wrapUpIssued: boolean = false,
    readonly staleTurns?: number,
  ) {
    super(`Background agent exhausted ${limit} agent turns.`);
    this.name = "BackgroundAgentTurnBudgetExceededError";
  }
}

// Number of turns remaining at which the executor stops encouraging further
// exploration and instead tells the agent to wrap up (#896).
const WRAP_UP_TURNS_REMAINING_THRESHOLD = 2;

/**
 * Builds the ephemeral per-turn budget note appended to the message history
 * sent to `openAgent.generate` (never persisted into canonical history, so
 * the counter is recomputed fresh each turn — see #896). The wrap-up
 * instruction is tool-aware: it only tells the agent to use GitHub actions
 * it actually has enabled (#896 follow-up).
 *
 * `hardTurnCap` is null unless BACKGROUND_AGENT_MAX_TURNS is explicitly set
 * (#914): with no cap there is no "of Y" framing and no wrap-up nudge tied to
 * turn count — the no-progress budget is what actually stops the run.
 */
function buildTurnBudgetNote(
  step: number,
  hardTurnCap: number | null,
  githubActionToggles: GitHubActionToggles,
): { note: string; wrapUp: boolean } {
  if (hardTurnCap === null) {
    return {
      note:
        `Turn ${step}. Keep this turn focused on concrete progress toward ` +
        "the deliverable.",
      wrapUp: false,
    };
  }

  const remaining = Math.max(hardTurnCap - step + 1, 1);
  const wrapUp = remaining <= WRAP_UP_TURNS_REMAINING_THRESHOLD;

  if (!wrapUp) {
    return {
      note:
        `Turn ${step} of ${hardTurnCap}. Keep this turn focused on concrete ` +
        "progress toward the deliverable.",
      wrapUp: false,
    };
  }

  const capability = resolveWrapUpCapability(githubActionToggles);
  let instruction: string;
  if (capability === "push_or_pr") {
    instruction =
      "commit and push your changes, then open the pull request or " +
      "complete the named deliverable with the progress made so far. " +
      "Do not start any new investigation.";
  } else if (capability === "comment_only") {
    instruction =
      "post your review/comment now with your findings and conclusions; " +
      "do not start new work.";
  } else {
    instruction =
      "finalize your output now using the tools available to you; " +
      "summarize what you accomplished, then stop — do not begin new " +
      "exploration.";
  }

  return {
    note: `Turn ${step} of ${hardTurnCap}. Stop exploring now and finalize: ${instruction}`,
    wrapUp: true,
  };
}

/**
 * Maps each native GitHub action tool name to the `backgroundAgentOutputs.kind`
 * value recorded for a successful call (#745/#746).
 */
const OUTPUT_KIND_BY_ACTION: Record<
  keyof BackgroundAgentGithubActions,
  NewBackgroundAgentOutput["kind"]
> = {
  open_pull_request: "ready_pr",
  comment_on_pr_or_issue: "pr_comment",
  approve_pull_request: "pr_review",
  request_changes: "pr_review",
  merge_pull_request: "merge",
  push: "push",
  delete_branch: "branch_delete",
};

/**
 * Human-readable tool names, in the same order actions are declared on
 * BackgroundAgentGithubActions, used to steer the run prompt.
 */
const GITHUB_ACTION_TOOL_NAMES: Record<
  keyof BackgroundAgentGithubActions,
  string
> = {
  open_pull_request: "github_open_pull_request",
  comment_on_pr_or_issue: "github_comment_on_pr_or_issue",
  approve_pull_request: "github_approve_pull_request",
  request_changes: "github_request_changes",
  merge_pull_request: "github_merge_pull_request",
  push: "github_push",
  delete_branch: "github_delete_branch",
};

/**
 * Converts the stored snake_case `githubActions` toggles into the camelCase
 * `GitHubActionToggles` shape expected by resolveGitHubActionTools. Missing
 * keys default to the module-level defaults (open_pull_request +
 * comment_on_pr_or_issue enabled, everything else disabled).
 */
function toGitHubActionToggles(
  actions: BackgroundAgentGithubActions | null | undefined,
): GitHubActionToggles {
  // The whole object defaults when the agent has never set githubActions
  // (null/undefined) — an agent that explicitly sets a partial object means
  // every OMITTED action is disabled, not defaulted back in.
  const merged = actions ?? defaultBackgroundAgentGithubActions;
  return {
    openPullRequest: merged.open_pull_request ?? false,
    commentOnPrOrIssue: merged.comment_on_pr_or_issue ?? false,
    approvePullRequest: merged.approve_pull_request ?? false,
    requestChanges: merged.request_changes ?? false,
    mergePullRequest: merged.merge_pull_request ?? false,
    push: merged.push ?? false,
    deleteBranch: merged.delete_branch ?? false,
  };
}

/**
 * Converts the flat `backgroundAgents.writeScope` column shape (schema.ts)
 * into the discriminated union `resolveGitHubActionTools` expects
 * (github-action-tools.ts). Both describe the same three modes; only the
 * `repos` field's presence differs by mode.
 */
function toGitHubToolsWriteScope(
  scope: import("@/lib/db/schema").BackgroundAgentWriteScope | null | undefined,
): GitHubToolsWriteScope {
  const resolved = scope ?? defaultBackgroundAgentWriteScope;
  if (resolved.mode === "specific_repos") {
    return { mode: "specific_repos", repos: resolved.repos ?? [] };
  }
  return { mode: resolved.mode };
}

function hasAnyWriteAction(toggles: GitHubActionToggles): boolean {
  return (
    toggles.push ||
    toggles.mergePullRequest ||
    toggles.deleteBranch ||
    toggles.openPullRequest ||
    toggles.approvePullRequest ||
    toggles.requestChanges
  );
}

function intersectGithubActionToggles(
  frozen: GitHubActionToggles,
  live: GitHubActionToggles,
): GitHubActionToggles {
  return {
    openPullRequest: frozen.openPullRequest && live.openPullRequest,
    commentOnPrOrIssue: frozen.commentOnPrOrIssue && live.commentOnPrOrIssue,
    approvePullRequest: frozen.approvePullRequest && live.approvePullRequest,
    requestChanges: frozen.requestChanges && live.requestChanges,
    mergePullRequest: frozen.mergePullRequest && live.mergePullRequest,
    push: frozen.push && live.push,
    deleteBranch: frozen.deleteBranch && live.deleteBranch,
  };
}

function intersectStringAllowlist(
  frozen: string[] | null,
  live: string[] | null,
): string[] | null {
  if (frozen === null) return live;
  if (live === null) return frozen;
  const liveSet = new Set(live);
  return frozen.filter((value) => liveSet.has(value));
}

function intersectRequestedSlugs(frozen: string[], live: string[]): string[] {
  const liveSet = new Set(live);
  return frozen.filter((value) => liveSet.has(value));
}

function intersectWriteScopes(
  frozen: BackgroundAgentExecutionSnapshotV1["writeScope"],
  live: import("@/lib/db/schema").BackgroundAgentWriteScope,
  boundRepo: { owner: string; name: string },
): BackgroundAgentExecutionSnapshotV1["writeScope"] {
  const normalizedLive: BackgroundAgentExecutionSnapshotV1["writeScope"] =
    live.mode === "specific_repos"
      ? { mode: "specific_repos", repos: live.repos ?? [] }
      : { mode: live.mode };
  if (frozen.mode === "all_repos") return normalizedLive;
  if (normalizedLive.mode === "all_repos") return frozen;
  const boundKey = `${boundRepo.owner}/${boundRepo.name}`.toLowerCase();
  if (frozen.mode === "this_repo" || normalizedLive.mode === "this_repo") {
    const other = frozen.mode === "this_repo" ? normalizedLive : frozen;
    if (other.mode !== "specific_repos") return { mode: "this_repo" };
    const includesBound = other.repos.some(
      (repo) => `${repo.owner}/${repo.name}`.toLowerCase() === boundKey,
    );
    return includesBound
      ? { mode: "this_repo" }
      : { mode: "specific_repos", repos: [] };
  }
  const liveKeys = new Set(
    normalizedLive.repos.map((repo) =>
      `${repo.owner}/${repo.name}`.toLowerCase(),
    ),
  );
  return {
    mode: "specific_repos",
    repos: frozen.repos.filter((repo) =>
      liveKeys.has(`${repo.owner}/${repo.name}`.toLowerCase()),
    ),
  };
}

function buildEffectiveSecurityPolicy(
  definition: BackgroundAgentExecutionSnapshotV1,
  liveAgent: import("@/lib/db/schema").BackgroundAgent,
) {
  return {
    githubActionToggles: intersectGithubActionToggles(
      toGitHubActionToggles(definition.githubActions),
      toGitHubActionToggles(liveAgent.githubActions),
    ),
    allowedBuiltinToolNames: intersectStringAllowlist(
      definition.builtinToolNames,
      liveAgent.builtinToolNames ?? null,
    ),
    requestedComposioSlugs: intersectRequestedSlugs(
      definition.composioToolkitSlugs,
      liveAgent.composioToolkitSlugs ?? [],
    ),
    effectiveWriteScope: intersectWriteScopes(
      definition.writeScope,
      liveAgent.writeScope,
      definition.repository,
    ),
    requireCiGreenForMerge:
      definition.requireCiGreenForMerge ||
      (liveAgent.requireCiGreenForMerge ?? true),
    // BackgroundAgentPermissions is not yet consumed by the executor. Keep it
    // in the policy fingerprint so a stricter live edit revokes the accepted
    // run instead of being silently ignored; #965 will make it executable.
    declaredPermissions: liveAgent.permissions,
  };
}

async function assertLiveBackgroundExecution(params: {
  runId: string;
  expectedPolicyHash?: string;
}): Promise<{
  row: NonNullable<Awaited<ReturnType<typeof getBackgroundAgentRunWithAgent>>>;
  resolved: ReturnType<typeof resolveBackgroundAgentExecutionDefinition>;
  policy: ReturnType<typeof buildEffectiveSecurityPolicy>;
}> {
  const row = await getBackgroundAgentRunWithAgent(params.runId);
  if (!row) {
    throw new BackgroundAgentSnapshotError(
      "agent_deleted",
      "Background Run or source was deleted during execution.",
    );
  }
  const resolved = resolveBackgroundAgentExecutionDefinition(
    row.run,
    row.agent,
  );
  if (!isBackgroundAgentsEnabled()) {
    throw new BackgroundAgentSnapshotError(
      "agent_disabled",
      "Background-agent execution is disabled by the live service policy.",
    );
  }
  const repoAccess = getBackgroundAgentRepoAccess(
    resolved.definition.repository.owner,
    resolved.definition.repository.name,
  );
  if (!repoAccess.allowed) {
    throw new BackgroundAgentSnapshotError(
      "agent_disabled",
      `Background-agent repository policy refused execution: ${repoAccess.reason}.`,
    );
  }
  if (!row.agent) {
    throw new BackgroundAgentSnapshotError(
      "agent_deleted",
      "Background agent configuration was deleted during execution.",
    );
  }
  const policy = buildEffectiveSecurityPolicy(resolved.definition, row.agent);
  if (
    params.expectedPolicyHash &&
    sha256CanonicalJson(policy) !== params.expectedPolicyHash
  ) {
    throw new BackgroundAgentSnapshotError(
      "agent_disabled",
      "Live Automation security policy changed during execution.",
    );
  }
  const requiredUserPermission =
    resolved.definition.source.builtinKind !== "pr_review_learnings" &&
    hasAnyWriteAction(policy.githubActionToggles)
      ? "write"
      : "read";
  const githubAccess = await verifyRepoAccess({
    userId: row.run.userId,
    owner: resolved.definition.repository.owner,
    repo: resolved.definition.repository.name,
    requiredUserPermission,
  });
  if (!githubAccess.ok) {
    throw new BackgroundAgentSnapshotError(
      githubAccess.reason === "no_installation" ||
        githubAccess.reason === "app_no_access"
        ? "installation_missing"
        : "permission_missing",
      getRepoAccessErrorMessage(githubAccess.reason),
    );
  }
  return { row, resolved, policy };
}

function guardToolSet(
  tools: import("ai").ToolSet | undefined,
  guard: () => Promise<void>,
): import("ai").ToolSet | undefined {
  if (!tools) return undefined;
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      const candidate = value as { execute?: (...args: unknown[]) => unknown };
      if (typeof candidate.execute !== "function") return [name, value];
      return [
        name,
        {
          ...candidate,
          execute: async (...args: unknown[]) => {
            await guard();
            return candidate.execute?.(...args);
          },
        },
      ];
    }),
  ) as import("ai").ToolSet;
}

function enabledGithubActionToolNames(toggles: GitHubActionToggles): string[] {
  const names: string[] = [];
  if (toggles.openPullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.open_pull_request);
  if (toggles.commentOnPrOrIssue)
    names.push(GITHUB_ACTION_TOOL_NAMES.comment_on_pr_or_issue);
  if (toggles.approvePullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.approve_pull_request);
  if (toggles.requestChanges)
    names.push(GITHUB_ACTION_TOOL_NAMES.request_changes);
  if (toggles.mergePullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.merge_pull_request);
  if (toggles.push) names.push(GITHUB_ACTION_TOOL_NAMES.push);
  if (toggles.deleteBranch) names.push(GITHUB_ACTION_TOOL_NAMES.delete_branch);
  return names;
}

function buildOutputKindByAction(): Record<
  string,
  NewBackgroundAgentOutput["kind"]
> {
  return {
    open_pull_request: OUTPUT_KIND_BY_ACTION.open_pull_request,
    comment_on_pr_or_issue: OUTPUT_KIND_BY_ACTION.comment_on_pr_or_issue,
    approve_pull_request: OUTPUT_KIND_BY_ACTION.approve_pull_request,
    request_changes: OUTPUT_KIND_BY_ACTION.request_changes,
    merge_pull_request: OUTPUT_KIND_BY_ACTION.merge_pull_request,
    push: OUTPUT_KIND_BY_ACTION.push,
    delete_branch: OUTPUT_KIND_BY_ACTION.delete_branch,
  };
}

function buildSandboxName(runId: string) {
  return `background_agent_${runId}`;
}

async function getGitUser(userId: string) {
  const profile = await getGitHubUserProfile(userId);
  const githubNoreplyEmail =
    profile?.externalUserId && profile.username
      ? `${profile.externalUserId}+${profile.username}@users.noreply.github.com`
      : undefined;

  return {
    name: profile?.username ?? "Open Agents",
    email: githubNoreplyEmail ?? `${userId}@users.noreply.github.com`,
  };
}

async function recordFailure(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName?: string | null;
  errorKind: string;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  await updateBackgroundAgentRunStatus({
    runId: params.runId,
    status: "failed",
    workflowRunId: params.workflowRunId,
    sandboxName: params.sandboxName ?? null,
    errorKind: params.errorKind,
    errorMessage: params.summary,
  });
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.run.failed",
    status: "failed",
    level: "warn",
    summary: params.summary,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName ?? null,
    errorKind: params.errorKind,
    ...(params.payload ? { payload: params.payload } : {}),
  });

  // Summary generation must never change the run status.
  try {
    await buildAndPersistRunSummary({
      runId: params.runId,
      agentId: params.agentId,
      userId: params.userId,
    });
  } catch (summaryError) {
    try {
      await recordSummaryFailedEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        error: summaryError,
      });
    } catch {
      // Best-effort; do not re-throw.
    }
  }
}

/**
 * Builds and persists a run summary at a terminal path.
 * MUST be wrapped in try/catch by the caller — summary failure must NOT
 * affect the run's terminal status.
 */
async function buildAndPersistRunSummary(params: {
  runId: string;
  agentId: string | null;
  userId: string;
}) {
  const [freshRun, cappedEvents, composioEvents, outputs] = await Promise.all([
    getBackgroundAgentRunWithAgent(params.runId),
    listBackgroundAgentEvents(params.runId),
    // #798 defect fix (Codex review P2-1): listBackgroundAgentEvents is a
    // bounded newest-200 slice. Composio resolution emits EARLY in a run,
    // so on a run with >200 total events, the composio events can fall off
    // that slice entirely — merge in an uncapped, composio-scoped fetch so
    // buildRunSummary never silently loses them.
    listBackgroundAgentComposioEvents(params.runId),
    listBackgroundAgentOutputs(params.runId),
  ]);

  if (!freshRun) {
    return;
  }

  const events = mergeEventsForSummary(cappedEvents, composioEvents);

  const summary = buildRunSummary({
    run: freshRun.run,
    events,
    outputs,
    // #798 defect fix: whether this run's agent had Composio toolkits
    // configured, gating run-summary.ts's "never resolved" copy. `agent`
    // is null when the row's left join finds no match (e.g. the owning
    // agent was deleted) — default to false (silence over noise) since we
    // genuinely cannot know in that case.
    composioConfigured: (freshRun.agent?.composioToolkitSlugs.length ?? 0) > 0,
  });

  await persistRunSummary({ runId: params.runId, summary });
}

async function execObservedCommand(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  eventName: string;
  command: string;
  timeoutMs?: number;
}) {
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: `${params.eventName}.started`,
    status: "running",
    summary: `Running ${params.command}`,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      command: params.command,
      timeoutMs: params.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    },
  });

  const startedAt = new Date();
  const result = await params.sandbox.exec(
    params.command,
    params.sandbox.workingDirectory,
    params.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
  );
  const finishedAt = new Date();
  const observation = buildBackgroundCommandObservation({
    command: params.command,
    startedAt,
    finishedAt,
    result,
  });

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: `${params.eventName}.completed`,
    status: result.success ? "succeeded" : "failed",
    level: result.success ? "info" : "warn",
    summary: result.success
      ? `Command passed: ${params.command}`
      : `Command failed: ${params.command}`,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    errorKind: result.success ? null : "checks_failed",
    payload: observation,
  });

  return result;
}

const GIT_PROGRESS_PROBE_TIMEOUT_MS = 15_000;

/**
 * Cheap per-turn probe for the no-progress (git-delta) budget (#914):
 * combines HEAD sha, porcelain status, and diff into one sandbox.exec call
 * (deliberately NOT routed through execObservedCommand, which would emit
 * .started/.completed events per sub-command and cost 6 events/turn — this
 * is one exec + one background-agent.progress.observed event per turn) and
 * hashes the raw stdout to sha256 so no diff content is ever logged.
 *
 * Returns null on any probe failure (non-zero exit or thrown error) — the
 * progress budget treats null as "unknown, not stale" rather than failing
 * the run over a sandbox/tooling hiccup.
 */
async function probeGitFingerprint(sandbox: Sandbox): Promise<string | null> {
  try {
    const result = await sandbox.exec(
      // A complete working-state fingerprint: committed HEAD + file states +
      // UNSTAGED tracked diffs + STAGED (index) tracked diffs + UNTRACKED file
      // contents. Each piece closes a false-stall gap: git status --porcelain
      // alone reports the same "M path"/"?? path" regardless of content, so
      // both `git diff` (unstaged) and `git diff --cached` (staged) are needed
      // for tracked edits, and ls-files|cat is needed for untracked contents
      // (git diff omits those).
      //
      // The whole thing is hashed INSIDE the sandbox (`| sha256sum`) so the
      // command returns a tiny fixed-size digest. sandbox.exec truncates stdout
      // to 50k chars; hashing app-side would let a large diff push later
      // sections (staged/untracked) past the cap, freezing the fingerprint
      // while the index changes. The OA_PROGRESS_PROBE markers keep the
      // sections unambiguous within the hashed stream.
      "{ git rev-parse HEAD; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git status --porcelain; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git diff; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git diff --cached; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git ls-files --others --exclude-standard -z | xargs -0 -r cat; } " +
        "2>/dev/null | sha256sum",
      sandbox.workingDirectory,
      GIT_PROGRESS_PROBE_TIMEOUT_MS,
    );
    if (!result.success) {
      return null;
    }
    // result.stdout is the in-sandbox digest (never truncated); re-hash for a
    // stable, fixed-length fingerprint regardless of the sha256sum output shape.
    return createHash("sha256").update(result.stdout).digest("hex");
  } catch {
    return null;
  }
}

function getSandboxState(sandbox: Sandbox): SandboxState {
  const state = sandbox.getState?.();
  if (!state || typeof state !== "object") {
    throw new Error("Background sandbox does not expose resumable state.");
  }
  return state as SandboxState;
}

/**
 * Resolves the agent's explicit model selection (agent.modelId) into an
 * OpenAgentCallOptions["model"] value. Returns `undefined` when the agent
 * has no explicit selection — the caller falls back to the default model.
 *
 * Never silently falls back on a resolution failure: the caller is
 * expected to fail the run with errorKind 'model_resolution_failed' when
 * this throws, because the user explicitly chose this model.
 */
async function resolveBackgroundAgentModel(params: {
  userId: string;
  modelId: string | null;
}): Promise<AgentModelSelection | undefined> {
  if (!params.modelId) {
    return undefined;
  }

  const parsed = parseModelOptionSelection(params.modelId);
  const baseSelection: AgentModelSelection = {
    id: parsed.modelId as AgentModelSelection["id"],
  };

  if (!parsed.inferenceProfileId) {
    return baseSelection;
  }

  return resolveInferenceProfileModelSelection({
    userId: params.userId,
    inferenceProfileId: parsed.inferenceProfileId,
    selection: baseSelection,
  });
}

async function runBackgroundAgent(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  prompt: string;
  /** Resolved enabled GitHub action toggles for this run (#896 follow-up):
   * drives the tool-aware wrap-up nudge so it never tells the agent to use
   * a GitHub action it doesn't have. */
  githubActionToggles: GitHubActionToggles;
  /** Merged Composio + native GitHub tools to inject into the agent loop. */
  extraTools?: import("ai").ToolSet;
  /** Pre-approved built-in tool names. null/absent = default policy. */
  allowedBuiltinToolNames?: string[] | null;
  /** Resolved model selection. undefined = inherit the agent-package default. */
  modelSelection?: AgentModelSelection;
  /** The model id recorded on usage events / the started event payload. */
  recordedModelId: string;
  assertLiveAuthorization: () => Promise<void>;
}) {
  let messages: ModelMessage[] = [
    {
      role: "user",
      content: params.prompt,
    },
  ];
  const options: OpenAgentCallOptions = {
    sandbox: {
      state: getSandboxState(params.sandbox),
      workingDirectory: params.sandbox.workingDirectory,
      currentBranch: params.sandbox.currentBranch,
      environmentDetails: params.sandbox.environmentDetails,
    },
    runtimeMode: "classic",
    // Unattended: no human can approve tool calls. Approval gates resolve
    // deterministically (web_fetch auto-approves; dangerous bash / sensitive
    // reads are denied via the sanitizer below) so a never-approved call cannot
    // wedge the run with a dangling tool_use.
    unattended: true,
    allowedBuiltinToolNames: params.allowedBuiltinToolNames ?? null,
    ...(params.modelSelection ? { model: params.modelSelection } : {}),
    customInstructions:
      "You are running inside an unattended background-agent workflow. Work autonomously, keep changes scoped, and finish with a concise summary.",
  };

  // (#914) BACKGROUND_AGENT_MAX_TURNS is now an opt-in absolute hard ceiling
  // — null (no cap) unless an operator explicitly sets it. The primary
  // budget is the no-progress (git-delta) budget below.
  const hardTurnCap = getBackgroundAgentHardTurnCap();
  const maxStaleTurns = getBackgroundAgentMaxStaleTurns();
  const initialFingerprint = await probeGitFingerprint(params.sandbox);
  const progressBudget = createProgressBudget({
    maxStaleTurns,
    initialFingerprint,
  });
  // (#915) Action-repetition / cycle detection: a second, independent
  // in-memory signal that ORs into the same stop path as the git-delta
  // budget above. Bounded ring buffer — only the most recent window of
  // whole-turn tool-call signatures is kept, both for memory and because
  // detectRepetition only ever looks at a short trailing window.
  const repetitionThreshold = getBackgroundAgentRepetitionThreshold();
  const RECENT_TOOL_SIGNATURES_CAP = 16;
  const recentToolSignatures: string[] = [];

  // (#916) Escalate-and-commit on stall: replaces the hard kill previously
  // thrown directly off the progress-budget/repetition verdicts below.
  const stallGraceTurns = getBackgroundAgentStallGraceTurns();
  const stallFinalizeTurns = getBackgroundAgentStallFinalizeTurns();
  const stallEscalation = createStallEscalation({
    graceTurns: stallGraceTurns,
    finalizeTurns: stallFinalizeTurns,
  });
  const wrapUpCapability = resolveWrapUpCapability(params.githubActionToggles);
  // One-shot: consumed by the very next turn's note, then cleared.
  let pendingStallNudge = false;
  // Set once escalation.observe() returns "escalate"; persists (and the
  // finalize note keeps being used) until the run terminates.
  let isEscalatingStall = false;
  let stallTrigger: StallTrigger | null = null;
  let lastStaleTurns = 0;
  // (#917) Runaway-COST fuse: accumulate token usage across turns and, if it
  // breaches the (deliberately high) per-run ceiling, force-escalate through
  // the same commit-and-finalize path as a stall — a cost backstop, not a
  // work limit.
  const maxRunTokens = getBackgroundAgentMaxRunTokens();
  let runTokens = 0;

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.agent.started",
    status: "running",
    summary: "Background agent started.",
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      // Retained for back-compat dashboards: null now that there is no
      // default total-turn cap.
      maxSteps: hardTurnCap,
      maxStaleTurns,
      hardTurnCap,
      repetitionThreshold,
      stallGraceTurns,
      stallFinalizeTurns,
      timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
      modelId: params.recordedModelId,
    },
  });

  let wrapUpIssued = false;
  let step = 0;

  for (;;) {
    await params.assertLiveAuthorization();
    step += 1;
    if (hardTurnCap !== null && step > hardTurnCap) {
      throw new BackgroundAgentTurnBudgetExceededError(
        hardTurnCap,
        wrapUpIssued,
      );
    }
    const startedAt = Date.now();
    // Repair any approval-gated tool call the previous turn left without a
    // result before re-sending history — otherwise the provider rejects the
    // request ("Tool result is missing for tool call …") and fails the run.
    // sanitizeUnattendedToolCalls returns the SAME array reference when
    // nothing needed fixing, so a reference change means it denied at least
    // one dangling tool call — surface that as an audit event per call.
    const sanitized = sanitizeUnattendedToolCalls(messages);
    if (sanitized !== messages) {
      for (const deniedToolName of collectDeniedToolNames(
        messages,
        sanitized,
      )) {
        await recordBackgroundAgentEvent({
          runId: params.runId,
          agentId: params.agentId,
          userId: params.userId,
          eventName: "background-agent.tool.denied",
          status: "failed",
          level: "warn",
          summary: `Denied unattended tool call: ${deniedToolName}`,
          workflowRunId: params.workflowRunId,
          requestId: params.requestId,
          sandboxName: params.sandboxName,
          payload: { toolName: deniedToolName },
        });
      }
    }
    messages = sanitized;

    // (#916) Note precedence: an active stall escalation takes over the
    // per-turn note entirely — finalize instruction while escalating, else
    // the one-shot re-plan nudge right after a stall is first detected,
    // else the existing turn-budget note.
    let note: string;
    if (isEscalatingStall) {
      note = buildStallFinalizeInstruction(
        wrapUpCapability,
        stallTrigger ?? "git_stale",
      );
    } else if (pendingStallNudge) {
      note = buildReplanNudgeNote();
      pendingStallNudge = false;
    } else {
      const built = buildTurnBudgetNote(
        step,
        hardTurnCap,
        params.githubActionToggles,
      );
      note = built.note;
      if (built.wrapUp) {
        wrapUpIssued = true;
      }
    }
    const turnMessages: ModelMessage[] = [
      ...messages,
      { role: "user", content: note },
    ];

    const result = await openAgent.generate({
      messages: turnMessages,
      options,
      ...(params.extraTools ? { tools: params.extraTools } : {}),
      timeout: { totalMs: DEFAULT_AGENT_TIMEOUT_MS },
    });
    await params.assertLiveAuthorization();
    const durationMs = Date.now() - startedAt;
    const toolCallCount = result.steps.reduce(
      (count, item) => count + item.toolCalls.length,
      0,
    );

    await recordBackgroundAgentEvent({
      runId: params.runId,
      agentId: params.agentId,
      userId: params.userId,
      eventName: "background-agent.agent.step.completed",
      status: "succeeded",
      summary: `Agent step ${step} completed with ${result.finishReason}.`,
      workflowRunId: params.workflowRunId,
      requestId: params.requestId,
      sandboxName: params.sandboxName,
      payload: {
        step,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason ?? null,
        durationMs,
        toolCallCount,
        usage: result.usage,
        totalUsage: result.totalUsage,
      },
    });

    // Record token usage to the usage_events table so background-agent
    // consumption is visible in usage dashboards, leaderboards, and public
    // profiles — not just in the background_agent_events JSONB payload.
    if (result.usage) {
      await recordUsage(params.userId, {
        source: "background-agent",
        agentType: "main",
        model: params.recordedModelId,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          cachedInputTokens: result.usage.cachedInputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
        toolCallCount,
      });
      // (#917) Accumulate toward the per-run token fuse.
      runTokens +=
        (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
    }

    // (#917) Runaway-cost fuse: once accumulated tokens breach the ceiling,
    // force-escalate through the stall path (fire once). The agent still gets
    // its finalize turns to commit/push/comment; the run then terminates as
    // token_budget_exceeded rather than being hard-killed with work discarded.
    let fuseFiredThisTurn = false;
    if (!isEscalatingStall && runTokens >= maxRunTokens) {
      fuseFiredThisTurn = true;
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.progress.token_fuse",
        status: "succeeded",
        level: "warn",
        summary: `Turn ${step}: per-run token fuse tripped (accumulatedTokens=${runTokens} >= ceiling=${maxRunTokens}).`,
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          step,
          accumulatedTokens: runTokens,
          ceiling: maxRunTokens,
        },
      });
      stallEscalation.forceEscalate("token_fuse");
      isEscalatingStall = true;
      stallTrigger = "token_fuse";
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.progress.escalated",
        status: "succeeded",
        level: "warn",
        summary: `Turn ${step}: stall escalated (token_fuse); instructing the agent to finalize.`,
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          step,
          staleTurns: lastStaleTurns,
          trigger: "token_fuse",
          capability: wrapUpCapability,
        },
      });
    }

    messages.push(...result.response.messages);

    if (result.finishReason !== "tool-calls") {
      // (#916) A stall that was escalated and then stops naturally (the
      // agent used its finalize turns to commit/push/comment and then
      // stopped issuing tool calls) is still a stalled outcome, not a
      // success — the run needed the escalation to get here.
      if (isEscalatingStall) {
        throw new BackgroundAgentStalledError(
          stallTrigger ?? "git_stale",
          wrapUpCapability,
          lastStaleTurns,
        );
      }
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.agent.completed",
        status: "succeeded",
        summary: "Background agent completed.",
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          finishReason: result.finishReason,
          steps: step,
        },
      });
      return;
    }

    // The agent is continuing (finishReason === "tool-calls"): probe the
    // sandbox git working tree and feed it to the no-progress budget (#914).
    // A probe failure degrades to null (treated as "unknown, not stale" by
    // createProgressBudget) rather than failing the run.
    const gitFingerprint = await probeGitFingerprint(params.sandbox);
    const { staleTurns, changed, verdict } = progressBudget.observeTurn({
      gitFingerprint,
    });
    lastStaleTurns = staleTurns;

    await recordBackgroundAgentEvent({
      runId: params.runId,
      agentId: params.agentId,
      userId: params.userId,
      eventName: "background-agent.progress.observed",
      status: "succeeded",
      summary: changed
        ? `Turn ${step}: git working tree changed.`
        : `Turn ${step}: no git working-tree change (staleTurns=${staleTurns}).`,
      workflowRunId: params.workflowRunId,
      requestId: params.requestId,
      sandboxName: params.sandboxName,
      payload: {
        step,
        gitFingerprint,
        changed,
        staleTurns,
        maxStaleTurns,
      },
    });

    // (#915) Independent second signal: feed this turn's whole-turn
    // tool-call signature into the repetition/cycle detector regardless of
    // the git-delta verdict above — a run can keep the git tree churning
    // every turn (never tripping the budget above) while still being stuck
    // repeating, or cycling through, the same tool call(s).
    const allToolCalls = result.steps.flatMap((item) => item.toolCalls);
    const turnSignature = hashTurnToolCalls(allToolCalls);
    let repetitionStop = false;
    if (turnSignature !== null) {
      recentToolSignatures.push(turnSignature);
      if (recentToolSignatures.length > RECENT_TOOL_SIGNATURES_CAP) {
        recentToolSignatures.shift();
      }
      const rep = detectRepetition(recentToolSignatures, {
        repeatThreshold: repetitionThreshold,
      });
      if (rep.flagged) {
        repetitionStop = true;
        await recordBackgroundAgentEvent({
          runId: params.runId,
          agentId: params.agentId,
          userId: params.userId,
          eventName: "background-agent.progress.repetition_detected",
          status: "succeeded",
          level: "warn",
          summary: `Turn ${step}: detected a ${rep.reason} pattern in the agent's tool calls.`,
          workflowRunId: params.workflowRunId,
          requestId: params.requestId,
          sandboxName: params.sandboxName,
          payload: {
            step,
            // Tool NAME only — never raw args/input, which are folded into
            // the (irreversible) signature hash above and never surfaced.
            toolName: allToolCalls[0]?.toolName ?? "unknown",
            repeatCount: rep.repeatCount,
            cycleLength: rep.cycleLength,
          },
        });
      }
    }

    // (#917) On the turn the token fuse fires, skip the stall observation so
    // the escalating countdown starts on the NEXT turn — this gives the agent
    // its finalize turns to commit/push before termination, matching the
    // normal escalate flow (an observe()-driven "escalate" never terminates
    // the same turn either).
    if (fuseFiredThisTurn) {
      continue;
    }

    // (#916) Feed both stall signals into the escalation state machine
    // instead of hard-killing the run directly. A "false" observation
    // (progress resumed) lets a run that recovers after a nudge continue
    // without ever escalating.
    const stalled = verdict === "stop" || repetitionStop;
    const trigger: StallTrigger | null = repetitionStop
      ? "repetition"
      : verdict === "stop"
        ? "git_stale"
        : null;
    const escalationResult = stallEscalation.observe({ stalled, trigger });

    if (escalationResult.action === "nudge") {
      pendingStallNudge = true;
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.progress.nudge_issued",
        status: "succeeded",
        level: "info",
        summary: `Turn ${step}: agent appears stalled (${escalationResult.trigger}); nudged to re-plan.`,
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          step,
          staleTurns,
          trigger: escalationResult.trigger,
          capability: wrapUpCapability,
        },
      });
    } else if (escalationResult.action === "escalate") {
      isEscalatingStall = true;
      stallTrigger = escalationResult.trigger;
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.progress.escalated",
        status: "succeeded",
        level: "warn",
        summary: `Turn ${step}: stall escalated (${escalationResult.trigger}); instructing the agent to finalize.`,
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          step,
          staleTurns,
          trigger: escalationResult.trigger,
          capability: wrapUpCapability,
        },
      });
    } else if (escalationResult.action === "terminate") {
      throw new BackgroundAgentStalledError(
        escalationResult.trigger ?? stallTrigger ?? "git_stale",
        wrapUpCapability,
        staleTurns,
      );
    }
  }
}

/**
 * Diffs the pre/post sanitizeUnattendedToolCalls message arrays to recover
 * the tool names that were denied. sanitizeUnattendedToolCalls does not
 * expose the denial list directly (see packages/agent/sanitize-tool-calls.ts
 * contract: same reference when unchanged, new array with injected
 * execution-denied tool-result messages when it rewrote history), so this
 * inspects the synthetic `tool` messages the sanitizer appended.
 */
export function collectDeniedToolNames(
  before: ModelMessage[],
  after: ModelMessage[],
): string[] {
  if (before === after) {
    return [];
  }
  // Only report denials the sanitizer added THIS round. Denials from earlier
  // rounds remain in the message history (same part object references), so
  // without this exclusion a later denial round would re-emit audit events
  // for every prior denial.
  const priorParts = new Set<unknown>();
  for (const message of before) {
    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content) {
        priorParts.add(part);
      }
    }
  }
  const names: string[] = [];
  for (const message of after) {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content as Array<Record<string, unknown>>) {
      if (priorParts.has(part)) {
        continue;
      }
      const output = part.output as { type?: string } | undefined;
      if (
        part.type === "tool-result" &&
        output?.type === "execution-denied" &&
        typeof part.toolName === "string"
      ) {
        names.push(part.toolName);
      }
    }
  }
  return names;
}

async function prepareWorkingBranch(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  branchName: string;
}) {
  const result = await execObservedCommand({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    sandbox: params.sandbox,
    eventName: "background-agent.git.branch",
    command: `git checkout ${params.branchName} 2>/dev/null || git checkout -b ${params.branchName}`,
    timeoutMs: 30_000,
  });

  if (!result.success) {
    throw new Error("Failed to prepare background-agent working branch.");
  }
}

/**
 * Reconstruct a NormalizedBackgroundTriggerEvent from the stored run columns.
 *
 * The run row persists source, triggerKind, externalId, repoOwner, repoName,
 * prNumber, ref, sha, branch, and payloadSummary (title, url, actor, action).
 * There is no 'merged' column, but for github.pull_request runs that reached
 * this branch the trigger had mergedOnly:true, so the PR was merged when the
 * run was created. We reconstruct merged:true for that kind.
 */
function reconstructEventFromRun(
  run: import("@/lib/db/schema").BackgroundAgentRun,
): NormalizedBackgroundTriggerEvent {
  return {
    source: run.source,
    kind: run.triggerKind,
    externalId: run.externalId,
    repoOwner: run.repoOwner,
    repoName: run.repoName,
    action: run.payloadSummary?.action ?? undefined,
    ref: run.ref ?? undefined,
    sha: run.sha ?? undefined,
    branch: run.branch ?? undefined,
    prNumber: run.prNumber ?? undefined,
    issueNumber: run.issueNumber ?? undefined,
    deploymentUrl: run.deploymentUrl ?? undefined,
    title: run.payloadSummary?.title ?? undefined,
    url: run.payloadSummary?.url ?? undefined,
    actor: run.payloadSummary?.actor ?? undefined,
    // Runs for github.pull_request with mergedOnly:true were always merged
    merged: run.triggerKind === "github.pull_request" ? true : undefined,
  };
}

/**
 * Generates structured learnings candidates from a PR diff using the default
 * LLM. Mirrors the generate pattern in lib/github/pr-content.ts.
 */
async function generateLearnings(prompt: string): Promise<unknown> {
  const result = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    prompt,
    experimental_output: Output.object({
      schema: extractedLearningCandidateSchema
        .array()
        .transform((candidates) => ({
          candidates,
        })),
    }),
  });
  return result.experimental_output;
}

/**
 * Runs the learnings extraction path without a sandbox.
 * Called from executeBackgroundAgentRun when the agent has the learnings marker.
 */
async function executeLearningsAgentRun(params: {
  run: import("@/lib/db/schema").BackgroundAgentRun;
  agentId: string;
  installationId: number;
  repositoryId: number;
  workflowRunId: string;
}) {
  const { run, agentId, installationId, repositoryId, workflowRunId } = params;

  const event = reconstructEventFromRun(run);
  const store = createDbLearningsStore();

  let result: import("@/lib/learnings/runner").RunLearningsExtractionResult;
  try {
    result = await withScopedInstallationOctokit({
      installationId,
      repositoryId,
      permissions: { contents: "read", pull_requests: "read" },
      operation: async (octokit) =>
        runLearningsExtraction({
          event,
          userId: run.userId,
          installationId,
          backgroundAgentRunId: run.id,
          octokit,
          generate: generateLearnings,
          store,
          recordEvent: (eventParams) =>
            recordBackgroundAgentEvent({
              ...(eventParams as Parameters<
                typeof recordBackgroundAgentEvent
              >[0]),
              workflowRunId,
            }).then(() => undefined),
        }),
    });
  } catch (error) {
    await updateBackgroundAgentRunStatus({
      runId: run.id,
      status: "failed",
      workflowRunId,
      errorKind: "workflow_failed",
      errorMessage:
        error instanceof Error ? error.message : "Learnings extraction failed.",
    });
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId,
      userId: run.userId,
      eventName: "learnings-agent.run.failed",
      status: "failed",
      level: "warn",
      summary: "Learnings extraction threw an unexpected error.",
      workflowRunId,
      requestId: run.requestId,
      errorKind: "workflow_failed",
    });
    return;
  }

  if (result.errorKind) {
    await updateBackgroundAgentRunStatus({
      runId: run.id,
      status: "failed",
      workflowRunId,
      errorKind: result.errorKind,
    });
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId,
      userId: run.userId,
      eventName: "learnings-agent.run.failed",
      status: "failed",
      level: "warn",
      summary: `Learnings extraction failed: ${result.errorKind}`,
      workflowRunId,
      requestId: run.requestId,
      errorKind: result.errorKind,
    });
    return;
  }

  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "succeeded",
    workflowRunId,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId,
    userId: run.userId,
    eventName: "learnings-agent.run.succeeded",
    summary: `Learnings extraction completed: ${result.accepted} accepted, ${result.rejected} rejected.`,
    status: "succeeded",
    workflowRunId,
    requestId: run.requestId,
    payload: {
      candidatesExtracted: result.candidatesExtracted,
      accepted: result.accepted,
      merged: result.merged,
      rejected: result.rejected,
    },
  });
}

export async function executeBackgroundAgentRun(params: {
  runId: string;
  workflowRunId: string;
}) {
  "use step";

  const row = await getBackgroundAgentRunWithAgent(params.runId);
  if (!row) {
    return;
  }

  const { run } = row;
  const sandboxName = buildSandboxName(run.id);

  let resolvedDefinition: ReturnType<
    typeof resolveBackgroundAgentExecutionDefinition
  >;
  let initialLiveCheck: Awaited<
    ReturnType<typeof assertLiveBackgroundExecution>
  >;
  try {
    initialLiveCheck = await assertLiveBackgroundExecution({ runId: run.id });
    resolvedDefinition = initialLiveCheck.resolved;
  } catch (error) {
    const snapshotError =
      error instanceof BackgroundAgentSnapshotError ? error : null;
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: snapshotError?.errorKind ?? "snapshot_invalid",
      summary:
        snapshotError?.message ?? "Background execution snapshot is invalid.",
    });
    return;
  }

  const claimed =
    run.status === "running" && run.workflowRunId === params.workflowRunId
      ? run
      : await updateBackgroundAgentRunStatus({
          runId: run.id,
          status: "running",
          workflowRunId: params.workflowRunId,
          sandboxName,
          expectedStatuses: ["queued"],
        });
  if (!claimed) return;
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.workflow.started",
    status: "running",
    summary: "Background agent workflow started.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });

  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName:
      resolvedDefinition.snapshotSource === "frozen"
        ? "background-agent.snapshot.validated"
        : "background-agent.snapshot.legacy_fallback",
    status: "succeeded",
    level: resolvedDefinition.snapshotSource === "frozen" ? "info" : "warn",
    summary:
      resolvedDefinition.snapshotSource === "frozen"
        ? "Validated frozen execution definition."
        : "Using legacy live Automation fallback.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    payload: {
      runId: run.id,
      agentId: run.agentId,
      definitionVersion: resolvedDefinition.definitionVersion,
      definitionHash: resolvedDefinition.definitionHash,
      snapshotSource: resolvedDefinition.snapshotSource,
      workflowRunId: params.workflowRunId,
    },
  });

  const liveAgent = initialLiveCheck.row.agent;
  if (!liveAgent) return;
  const definition = resolvedDefinition.definition;
  const {
    githubActionToggles,
    allowedBuiltinToolNames,
    requestedComposioSlugs,
    effectiveWriteScope,
    requireCiGreenForMerge,
  } = initialLiveCheck.policy;
  const expectedPolicyHash = sha256CanonicalJson(initialLiveCheck.policy);
  const assertLiveAuthorization = async () => {
    await assertLiveBackgroundExecution({
      runId: run.id,
      expectedPolicyHash,
    });
  };
  // The built-in learnings agent never takes GitHub actions (its branch below
  // bypasses the sandbox + tool loop entirely), so it must not inherit a
  // write requirement from action toggles — read-only users run it too.
  const requiredUserPermission =
    definition.source.builtinKind !== "pr_review_learnings" &&
    hasAnyWriteAction(githubActionToggles)
      ? "write"
      : "read";

  const access = await verifyRepoAccess({
    userId: run.userId,
    owner: run.repoOwner,
    repo: run.repoName,
    requiredUserPermission,
  });
  if (!access.ok) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind:
        access.reason === "no_installation" || access.reason === "app_no_access"
          ? "installation_missing"
          : "permission_missing",
      summary: getRepoAccessErrorMessage(access.reason),
    });
    return;
  }

  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.github.installation.resolved",
    status: "succeeded",
    summary: "Resolved repo-scoped GitHub App installation access.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    payload: {
      repositoryId: access.repositoryId,
      defaultBranch: access.defaultBranch,
    },
  });

  // ── Built-in learnings agent branch ──────────────────────────────────────
  // Detected by marker in instructions. Runs extraction without sandbox —
  // do not pay sandbox costs for this read-only arc.
  if (definition.source.builtinKind === "pr_review_learnings") {
    await executeLearningsAgentRun({
      run,
      agentId: definition.source.definitionId,
      installationId: access.installationId,
      repositoryId: access.repositoryId,
      workflowRunId: params.workflowRunId,
    });
    return;
  }

  // ── Resolve model selection before paying sandbox costs ──────────────────
  // A misconfigured explicit model selection must fail the run rather than
  // silently fall back — the user chose this model. Failing before sandbox
  // setup avoids paying sandbox costs for a run that cannot proceed.
  let resolvedModelSelection: AgentModelSelection | undefined;
  try {
    resolvedModelSelection = await resolveBackgroundAgentModel({
      userId: run.userId,
      modelId: definition.modelId,
    });
  } catch (error) {
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "model_resolution_failed",
      summary:
        error instanceof Error
          ? error.message
          : "Failed to resolve the agent's selected model.",
    });
    return;
  }
  const recordedModelId = resolvedModelSelection?.id ?? defaultModelLabel;

  let setupToken: ScopedInstallationToken | undefined;
  let sandbox: Sandbox | undefined;
  try {
    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        sandboxName,
        source: {
          repo: `https://github.com/${run.repoOwner}/${run.repoName}.git`,
          branch: run.ref ?? run.branch ?? access.defaultBranch,
        },
      },
      options: {
        githubToken: setupToken.token,
        gitUser: await getGitUser(run.userId),
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
  } catch (error) {
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "sandbox_unavailable",
      summary:
        error instanceof Error
          ? error.message
          : "Failed to start background sandbox.",
    });
    return;
  } finally {
    if (setupToken) {
      await revokeInstallationToken(setupToken.token);
    }
  }

  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.sandbox.started",
    status: "succeeded",
    summary: "Background sandbox is ready.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    payload: {
      sandboxName,
      workingDirectory: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      host: sandbox.host,
    },
  });

  await execObservedCommand({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    sandbox,
    eventName: "background-agent.git.context",
    command: "git status --short && git rev-parse --short HEAD",
    timeoutMs: 15_000,
  });

  // ── Prepare a run-scoped working branch when any write action is enabled ─
  // Gives github_push a sane default target branch instead of the repo's
  // default branch. Comment/review-only agents skip this — there is nothing
  // to push.
  let workingBranch: string | null = null;
  if (hasAnyWriteAction(githubActionToggles)) {
    workingBranch = buildBackgroundBranchName({
      agentName: definition.source.name,
      runId: run.id,
    });

    try {
      await prepareWorkingBranch({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        sandbox,
        branchName: workingBranch,
      });
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.git.branch.resolved",
        status: "succeeded",
        summary: "Prepared background-agent working branch.",
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        payload: { branchName: workingBranch },
      });
    } catch (error) {
      await recordFailure({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        errorKind: "workflow_failed",
        summary:
          error instanceof Error
            ? error.message
            : "Failed to prepare background-agent working branch.",
      });
      return;
    }
  }

  // ── Resolve Composio tools for this run ──────────────────────────────────
  // Attempted when the agent has non-empty composioToolkitSlugs.
  // Empty slugs = no-op (pre-Phase-5 behavior).
  // The resolver handles repo policy gating: blocked toolkit slugs are
  // filtered out before resolution; if none remain, the resolver returns a
  // typed { status: "off", reason: "repo_policy_blocked" } outcome without
  // making any external Composio calls.
  let resolvedComposioTools: import("ai").ToolSet | undefined;
  const agentToolkitSlugs = requestedComposioSlugs;

  if (agentToolkitSlugs.length > 0) {
    const composioResult = await resolveComposioToolsForBgRun({
      agentId: run.agentId,
      runId: run.id,
      userId: run.userId,
      slugs: agentToolkitSlugs,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
    });

    if (composioResult.status === "ready") {
      resolvedComposioTools = composioResult.tools;
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.composio.resolved",
        status: "succeeded",
        summary: `Resolved Composio tools: ${composioResult.toolkitSlugs.join(", ")}.`,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        // Payload: toolkit names only — no secrets, no API keys.
        payload: {
          toolkitSlugs: composioResult.toolkitSlugs,
          toolCount: Object.keys(composioResult.tools).length,
          disconnectedToolkits: composioResult.disconnectedToolkits,
        },
      });

      // #798: surface toolkits that resolved but have no ACTIVE connected
      // account — previously discarded entirely (finding A4). Additive to
      // .resolved, not a replacement: the run still has (partial) tools.
      if (composioResult.disconnectedToolkits.length > 0) {
        await recordBackgroundAgentEvent({
          runId: run.id,
          agentId: run.agentId,
          userId: run.userId,
          eventName: "background-agent.composio.not_connected",
          status: "succeeded",
          level: "warn",
          summary: `Composio toolkits resolved but not connected: ${composioResult.disconnectedToolkits.join(", ")}.`,
          workflowRunId: params.workflowRunId,
          requestId: run.requestId,
          sandboxName,
          payload: {
            disconnectedToolkits: composioResult.disconnectedToolkits,
          },
        });
      }
    } else if (composioResult.status === "error") {
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.composio.error",
        status: "failed",
        level: "warn",
        summary: `Composio tool resolution failed: ${composioResult.message}`,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        // #798: errorKind is now recorded so run-summary.ts can surface it
        // in warnings[] regardless of the run's terminal status.
        errorKind: composioResult.errorKind,
        payload: {
          // Do NOT include error details that might contain secrets
          toolkitSlugsRequested: agentToolkitSlugs,
        },
      });
      // Non-fatal: run continues without Composio tools.
    } else {
      // #798: composioResult.status === "off" — every non-ready, non-error
      // resolver outcome now emits a named event instead of the previous
      // silent no-op (finding A1). Non-fatal: the run continues without
      // Composio tools; status stays "succeeded" here because this event
      // does not by itself represent a run failure.
      //
      // #799 extends this switch with "not_in_repo_allowlist" (a non-null
      // repo selectedToolkitSlugs allowlist dropped every requested slug) —
      // distinct copy from "repo_policy_blocked" (denylist) so operators can
      // tell which policy axis caused the drop.
      let offSummary: string;
      if (composioResult.reason === "repo_policy_blocked") {
        offSummary = `Composio tools blocked by repo policy: ${(composioResult.blockedSlugs ?? []).join(", ")}.`;
      } else if (composioResult.reason === "not_in_repo_allowlist") {
        offSummary = `Composio tools not in repository allowlist: ${(composioResult.blockedSlugs ?? []).join(", ")}.`;
      } else {
        offSummary =
          "Composio tools requested but no toolkit slugs were selected.";
      }
      const includeBlockedSlugsInPayload =
        composioResult.reason === "repo_policy_blocked" ||
        composioResult.reason === "not_in_repo_allowlist";
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.composio.off",
        status: "succeeded",
        level: "warn",
        summary: offSummary,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        payload: {
          reason: composioResult.reason,
          ...(includeBlockedSlugsInPayload
            ? { blockedSlugs: composioResult.blockedSlugs ?? [] }
            : {}),
        },
      });
    }
  }

  // ── Resolve native GitHub action tools, filtered by the agent's toggles ──
  const githubActionTools = resolveGitHubActionTools({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    workflowRunId: params.workflowRunId,
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    repoOwner: run.repoOwner,
    repoName: run.repoName,
    defaultBranch: access.defaultBranch,
    sandbox,
    toggles: githubActionToggles,
    writeScope: toGitHubToolsWriteScope(effectiveWriteScope),
    requireCiGreen: requireCiGreenForMerge,
    userPermission: access.userPermission,
    outputKindByAction: buildOutputKindByAction(),
    // Parity with the old ready_pr flow, where the required check ran BEFORE
    // any commit/PR reached GitHub: github_push re-runs this gate inside the
    // tool, so a failing check can never produce a pushed branch or PR.
    checkCommand: definition.checkCommand,
  });

  const extraTools = guardToolSet(
    mergeExtraTools(
      resolvedComposioTools,
      // mergeExtraTools treats a defined-but-empty ToolSet as "has tools" (it
      // only short-circuits to undefined when BOTH inputs are absent) — pass
      // undefined instead of {} when no GitHub actions are toggled on so a
      // comment-only-disabled agent doesn't get a spurious empty tools key.
      Object.keys(githubActionTools).length > 0 ? githubActionTools : undefined,
    ),
    assertLiveAuthorization,
  );

  // ── Every run now executes the agent loop ────────────────────────────────
  try {
    await runBackgroundAgent({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      sandbox,
      prompt: buildBackgroundAgentRunbookPrompt({
        agentName: definition.source.name,
        instructions: definition.instructions,
        triggerKind: run.triggerKind,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        ref: run.ref,
        sha: run.sha,
        branch: run.branch,
        prNumber: run.prNumber,
        issueNumber: run.issueNumber,
        deploymentUrl: run.deploymentUrl,
        payloadSummary: run.payloadSummary,
        checkCommand: definition.checkCommand,
        workingBranch,
        enabledGithubActionTools:
          enabledGithubActionToolNames(githubActionToggles),
      }),
      githubActionToggles,
      extraTools,
      allowedBuiltinToolNames,
      modelSelection: resolvedModelSelection,
      recordedModelId,
      assertLiveAuthorization,
    });
  } catch (error) {
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind:
        error instanceof BackgroundAgentSnapshotError
          ? error.errorKind
          : error instanceof BackgroundAgentStalledError
            ? error.trigger === "token_fuse"
              ? "token_budget_exceeded"
              : "agent_stalled"
            : error instanceof BackgroundAgentTurnBudgetExceededError
              ? "agent_turn_budget_exceeded"
              : "workflow_failed",
      summary:
        error instanceof Error ? error.message : "Background agent failed.",
      ...(error instanceof BackgroundAgentStalledError
        ? {
            payload: {
              trigger: error.trigger,
              capability: error.capability,
              staleTurns: error.staleTurns,
              nudgeIssued: error.nudgeIssued,
            },
          }
        : error instanceof BackgroundAgentTurnBudgetExceededError
          ? {
              payload: {
                wrapUpIssued: error.wrapUpIssued,
                ...(error.staleTurns !== undefined
                  ? { staleTurns: error.staleTurns }
                  : {}),
              },
            }
          : {}),
    });
    return;
  }

  try {
    await assertLiveAuthorization();
  } catch (error) {
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind:
        error instanceof BackgroundAgentSnapshotError
          ? error.errorKind
          : "workflow_failed",
      summary:
        error instanceof Error
          ? error.message
          : "Live authorization check failed.",
    });
    return;
  }
  if (definition.checkCommand?.trim()) {
    const checkResult = await execObservedCommand({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      sandbox,
      eventName: "background-agent.check",
      command: definition.checkCommand.trim(),
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
    });

    if (!checkResult.success) {
      await recordFailure({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        errorKind: "checks_failed",
        summary: "Required background-agent check failed.",
      });
      return;
    }
  } else {
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      eventName: "background-agent.check.completed",
      status: "skipped",
      summary: "No check command configured.",
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
    });
  }

  // Terminal success: the outputUrl is the URL of the most recent successful
  // GitHub action output recorded for this run, if any.
  const outputs = await listBackgroundAgentOutputs(run.id);
  const latestOutputWithUrl = outputs.find(
    (output) => output.status === "created" && output.url,
  );

  try {
    await assertLiveAuthorization();
  } catch (error) {
    const freshRow = await getBackgroundAgentRunWithAgent(run.id);
    await recordFailure({
      runId: run.id,
      agentId: freshRow?.run.agentId ?? null,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind:
        error instanceof BackgroundAgentSnapshotError
          ? error.errorKind
          : "workflow_failed",
      summary:
        error instanceof Error
          ? error.message
          : "Live authorization check failed.",
    });
    return;
  }
  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "succeeded",
    workflowRunId: params.workflowRunId,
    sandboxName,
    outputUrl: latestOutputWithUrl?.url ?? null,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.run.completed",
    status: "succeeded",
    summary: "Background agent run completed.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
  });

  // Summary must not affect run status on failure.
  try {
    await buildAndPersistRunSummary({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
    });
  } catch (summaryError) {
    try {
      await recordSummaryFailedEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        error: summaryError,
      });
    } catch {
      // Best-effort; do not re-throw.
    }
  }
}
