import { isSafeBranchName } from "@/lib/git/helpers";
import type { GitHubToolAction } from "./github-actions";
import type { BackgroundAgentTriggerKind } from "./types";

const MAX_PR_TITLE_LENGTH = 72;

/**
 * Human-readable, per-action tool-call guidance shown to the model in the
 * mutation prompt. Keyed by GitHubToolAction so the instruction list only
 * ever mentions tools the agent actually has enabled (#740 STEP-9).
 */
const ACTION_TOOL_GUIDANCE: Record<GitHubToolAction, string> = {
  open_pull_request:
    'When your changes are complete and verified, call the "github_open_pull_request" tool to commit your work and open a pull request.',
  comment_on_pr_or_issue:
    'Call the "github_comment_on_pr_or_issue" tool to post a comment on the relevant pull request or issue.',
  approve_pull_request:
    'Call the "github_approve_pull_request" tool to approve a pull request once you have verified it is ready.',
  request_changes:
    'Call the "github_request_changes" tool to request changes on a pull request, including a clear explanation in the review body.',
  merge_pull_request:
    'Call the "github_merge_pull_request" tool to merge a pull request once it is ready.',
  push: 'Call the "github_push" tool to push your committed changes to a branch.',
  delete_branch:
    'Call the "github_delete_branch" tool to delete a branch that is no longer needed.',
};

function sanitizeBranchSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "run"
  );
}

export function buildBackgroundBranchName(params: {
  agentName: string;
  runId: string;
}): string {
  const branch = `background-agent/${sanitizeBranchSegment(params.agentName)}/${sanitizeBranchSegment(params.runId).slice(0, 12)}`;
  if (!isSafeBranchName(branch)) {
    return `background-agent/run/${sanitizeBranchSegment(params.runId).slice(0, 12)}`;
  }
  return branch;
}

export function buildBackgroundAgentMutationPrompt(params: {
  agentName: string;
  instructions: string;
  triggerKind: BackgroundAgentTriggerKind;
  repoOwner: string;
  repoName: string;
  ref?: string | null;
  sha?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  issueNumber?: number | null;
  deploymentUrl?: string | null;
  payloadSummary?: unknown;
  checkCommand?: string | null;
  /**
   * Actions the model may call as native github_* tools this run. Governs
   * which tool-call instructions are surfaced below — an agent with no
   * enabled actions gets no tool-call guidance at all.
   */
  enabledActions: GitHubToolAction[];
}): string {
  const summary = params.payloadSummary
    ? JSON.stringify(params.payloadSummary, null, 2)
    : "{}";
  const checkCommand = params.checkCommand?.trim();
  const toolGuidance = params.enabledActions
    .map((action) => `- ${ACTION_TOOL_GUIDANCE[action]}`)
    .join("\n");

  return `You are running as a background agent named "${params.agentName}".

Repository: ${params.repoOwner}/${params.repoName}
Trigger: ${params.triggerKind}
Ref: ${params.ref ?? "unknown"}
Branch: ${params.branch ?? "unknown"}
SHA: ${params.sha ?? "unknown"}
Pull request: ${params.prNumber ?? "none"}
Issue: ${params.issueNumber ?? "none"}
Deployment URL: ${params.deploymentUrl ?? "none"}

Trigger summary:
${summary}

Standing instructions:
${params.instructions}

Work autonomously in the sandbox. Make the smallest scoped code changes needed to satisfy the standing instructions for this trigger. Do not ask the user questions. Do not edit GitHub Actions or workflow files unless the standing instructions explicitly require that.

${
  toolGuidance
    ? `You have the following GitHub actions available as tools. Use them when your work is ready:\n${toolGuidance}`
    : "You do not have any GitHub write/comment tools enabled for this run. Do not attempt to create, push, or open a pull request yourself."
}

${checkCommand ? `The required check command after your changes is:\n${checkCommand}` : "No required check command is configured."}`;
}

export function buildBackgroundPullRequestTitle(agentName: string): string {
  const title = `chore: ${agentName}`;
  return title.length <= MAX_PR_TITLE_LENGTH
    ? title
    : title.slice(0, MAX_PR_TITLE_LENGTH).trimEnd();
}

export function buildBackgroundPullRequestBody(params: {
  runId: string;
  agentName: string;
  triggerKind: BackgroundAgentTriggerKind;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  branchName: string;
  commitSha: string;
  checkCommand?: string | null;
  runUrl?: string | null;
}): string {
  const runLine = params.runUrl
    ? `[Background run](${params.runUrl})`
    : `Background run: ${params.runId}`;
  const checkLine = params.checkCommand?.trim()
    ? `- Check: \`${params.checkCommand.trim()}\``
    : "- Check: not configured";

  return `## Summary

Automated changes from background agent **${params.agentName}** for \`${params.triggerKind}\`.

## Evidence

- ${runLine}
- Repository: \`${params.repoOwner}/${params.repoName}\`
- Branch: \`${params.branchName}\` into \`${params.baseBranch}\`
- Commit: \`${params.commitSha}\`
${checkLine}

This PR was created only after the configured sandbox work and required checks completed successfully.`;
}
