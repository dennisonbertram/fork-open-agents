import { isSafeBranchName } from "@/lib/git/helpers";
import type { BackgroundAgentTriggerKind } from "./types";

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

/**
 * Builds the standing prompt for a background-agent run (#746). Unlike the
 * old mutation prompt, this does NOT forbid the agent from pushing or
 * opening a pull request itself — the agent has direct access to the
 * `github_*` action tools (filtered by the agent's enabled toggles) and is
 * expected to use them to accomplish the standing instructions.
 */
export function buildBackgroundAgentRunbookPrompt(params: {
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
  /** Sandbox working branch prepared by the executor before the loop, when
   * any write action is enabled. Absent for comment/review-only agents. */
  workingBranch?: string | null;
  /** Human-readable labels for the GitHub action tools enabled for this run
   * (e.g. "github_push", "github_open_pull_request"). Empty = no GitHub
   * automation available this run. */
  enabledGithubActionTools: string[];
}): string {
  const summary = params.payloadSummary
    ? JSON.stringify(params.payloadSummary, null, 2)
    : "{}";
  const checkCommand = params.checkCommand?.trim();

  const toolsSection =
    params.enabledGithubActionTools.length > 0
      ? `You have access to the following GitHub action tools: ${params.enabledGithubActionTools.join(", ")}. Only use the tools listed here — do not attempt any other GitHub write action; it is disabled for this agent and will be refused.`
      : "No GitHub action tools are enabled for this agent. You may still read the repository, but you cannot push, comment, review, merge, or delete branches.";

  const branchSection = params.workingBranch
    ? `Your working branch for this run is \`${params.workingBranch}\`. When you use \`github_push\`, target this branch unless the standing instructions require otherwise. When you use \`github_open_pull_request\`, use this branch as the head.`
    : "";

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

Work autonomously in the sandbox. Make the smallest scoped changes needed to satisfy the standing instructions for this trigger. Do not ask the user questions.

${toolsSection}
${branchSection ? `\n${branchSection}\n` : ""}
For code changes: make your edits in the sandbox, then call \`github_push\` to commit and push them, then call \`github_open_pull_request\` to open a pull request (when both tools are enabled). Do not edit GitHub Actions or workflow files unless the standing instructions explicitly require that.

${checkCommand ? `The required check command after your changes is:\n${checkCommand}` : "No required check command is configured."}`;
}
