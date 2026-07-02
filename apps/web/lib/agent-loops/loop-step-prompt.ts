/**
 * Agent Loops — loop step prompt builder (M1-05)
 *
 * buildLoopStepPrompt({ node, contextSlice, repo, branch }): string
 *
 * Produces the prompt for an agent_step node, including:
 *   - node instructions (the "what to do")
 *   - serialized run-context slice (the "state from prior steps")
 *   - output contract: write structured JSON to /tmp/loop-step-output.json
 *   - explicit prohibitions: no push, no PRs, no writes outside workspace
 *   - repo + branch context
 *
 * The output contract requires the agent to write a JSON object whose
 * "branch" field declares the branch it worked on (or intends to push to).
 * The executor reads this field to know which branch to push to.
 */

import "server-only";

import type { AgentStepNode } from "./types";

export type BuildLoopStepPromptParams = {
  node: AgentStepNode;
  contextSlice: Record<string, unknown>;
  repo: string;
  branch: string;
  /** When set, appends a watchdog hint section from the previous failed attempt. */
  watchdogHint?: string;
};

/**
 * Builds the prompt for an agent_step node.
 *
 * Branch declaration convention:
 *   The agent MUST include a "branch" field in its output JSON at
 *   /tmp/loop-step-output.json. The executor reads this to know which branch
 *   to commit and push to. If the agent worked on a branch it checked out
 *   (e.g., "feat/my-feature"), it should declare that branch. If it worked
 *   directly on the cloned branch, it should echo back the branch name it
 *   received in this prompt.
 */
export function buildLoopStepPrompt(params: BuildLoopStepPromptParams): string {
  const { node, contextSlice, repo, branch, watchdogHint } = params;

  const instructionsSection = node.instructions
    ? `## Your Instructions\n\n${node.instructions}\n`
    : `## Your Instructions\n\nComplete the work described in the context below.\n`;

  const contextSection =
    Object.keys(contextSlice).length > 0
      ? `## Run Context (state from prior steps)\n\n\`\`\`json\n${JSON.stringify(contextSlice, null, 2)}\n\`\`\`\n`
      : `## Run Context\n\nNo prior step context available.\n`;

  const repoSection = `## Repository\n\n- Repo: \`${repo}\`\n- Branch: \`${branch}\`\n`;

  const outputContract = `## Output Contract (REQUIRED)

When you have completed your work, you MUST write a JSON object to the file
\`/tmp/loop-step-output.json\`. This is the ONLY way to communicate results.

Your output must be a valid JSON object. Do NOT write prose to this path —
write structured data only.

Required fields:
- \`"branch"\` (string): The branch you worked on. Use the branch name you
  checked out, or \`"${branch}"\` if you worked on the default branch.

Example:
\`\`\`json
{
  "branch": "${branch}",
  "result": "Your summary here"
}
\`\`\`

Write this file before finishing. If the file is missing or contains invalid
JSON, the step will be marked as failed.
`;

  // #765: PR creation is prohibited by default (dedicated steps handle it),
  // UNLESS this node was granted permissions.github.pullRequests === "write" —
  // the minted installation token already carries that scope in that case
  // (see agent-step.ts's permissionsToInstallationToken call), so the step is
  // explicitly permitted to run `gh pr create`. Every other prohibition stays
  // verbatim for every step.
  const canCreatePr = node.permissions?.github?.pullRequests === "write";

  const prohibitions = `## Strict Prohibitions

- **Do NOT push** any commits. The executor handles all git push operations.
  Never run \`git push\` or any equivalent command.
${
  canCreatePr
    ? `- **You MAY open pull requests.** This step was granted pull-request
  write access, so \`gh pr create\` is permitted here (unlike most steps).
`
    : `- **Do NOT open pull requests**. PR creation is handled by dedicated steps.
  Never run \`gh pr create\` or use any GitHub API to open a PR.
`
}- **Do NOT write outside the workspace** (outside the cloned repository
  directory). Restrict all file writes to the working directory.
`;

  const watchdogHintSection = watchdogHint
    ? `## Watchdog hint from the previous failed attempt\n\n` +
      `> ${watchdogHint.replace(/\n/g, "\n> ")}\n\n` +
      `Apply this guidance when working on this attempt.\n`
    : null;

  const sections: (string | null)[] = [
    `# Agent Loop Step`,
    "",
    "You are running inside an unattended agent loop step. Work autonomously,",
    "keep changes focused, and write your structured output JSON when done.",
    "",
    repoSection,
    contextSection,
    watchdogHintSection,
    instructionsSection,
    outputContract,
    prohibitions,
  ];

  return sections.filter((s): s is string => s !== null).join("\n");
}
