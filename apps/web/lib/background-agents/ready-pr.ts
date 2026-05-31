import { isSafeBranchName } from "@/lib/git/helpers";
import type { BackgroundAgentTriggerKind } from "./types";

const MAX_PR_TITLE_LENGTH = 72;

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
}): string {
  const summary = params.payloadSummary
    ? JSON.stringify(params.payloadSummary, null, 2)
    : "{}";
  const checkCommand = params.checkCommand?.trim();

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

Work autonomously in the sandbox. Make the smallest scoped code changes needed to satisfy the standing instructions for this trigger. Do not ask the user questions. Do not create, push, or open a pull request yourself; the background-agent executor will run checks and create the PR after your work is complete. Do not edit GitHub Actions or workflow files unless the standing instructions explicitly require that.

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
