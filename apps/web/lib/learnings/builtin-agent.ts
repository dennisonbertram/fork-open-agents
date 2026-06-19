import "server-only";

import {
  createBackgroundAgent,
  listRepoBackgroundAgents,
  updateBackgroundAgent,
} from "@/lib/background-agents/store";
import { getBackgroundAgentRepoReadiness } from "@/lib/background-agents/repo-readiness";

/**
 * Stable marker embedded in the built-in PR-review learnings agent instructions.
 * Used to find and identify the agent without a dedicated DB column.
 * DO NOT change — changing breaks find-by-marker for existing rows.
 */
export const LEARNINGS_AGENT_MARKER = "[builtin:pr-review-learnings]";

/**
 * Identifies a background agent as the built-in learnings agent by checking
 * whether its instructions contain the stable marker string.
 */
export function isLearningsAgent(
  agent: Pick<{ instructions: string }, "instructions">,
): boolean {
  return agent.instructions.includes(LEARNINGS_AGENT_MARKER);
}

export type EnsureRepoLearningsAgentResult = {
  agentId?: string;
  errorKind?: string;
  idempotent?: boolean;
};

export type DisableRepoLearningsAgentResult = {
  agentId?: string;
  errorKind?: string;
};

export type GetRepoLearningsAgentStatusResult = {
  enabled: boolean;
  agentId?: string;
};

/**
 * Idempotently create or update the built-in learnings agent for a repo.
 * Write-access gated: returns errorKind if the user lacks the required
 * permission or has no GitHub App installation covering the repo.
 *
 * Default OFF: the agent is created with status "disabled" when enabled=false.
 */
export async function ensureRepoLearningsAgent(
  userId: string,
  repoOwner: string,
  repoName: string,
  enabled: boolean,
): Promise<EnsureRepoLearningsAgentResult> {
  // Gate: verify write access before any writes
  const readiness = await getBackgroundAgentRepoReadiness({
    userId,
    repoOwner,
    repoName,
    requiredUserPermission: "write",
  });

  if (!readiness.ready) {
    const reason = readiness.reason;
    // Map access reasons to our error taxonomy
    if (reason === "no_installation" || reason === "app_no_access") {
      return { errorKind: "no_installation" };
    }
    if (reason === "user_no_write" || reason === "user_no_access") {
      return { errorKind: "user_no_write" };
    }
    // github_error or other
    return { errorKind: "no_installation" };
  }

  // Find any existing learnings agent for this (userId, repoOwner, repoName)
  const existing = await listRepoBackgroundAgents({
    userId,
    repoOwner,
    repoName,
  });

  const existingLearningsAgent = existing.find((agent) =>
    isLearningsAgent(agent),
  );

  const targetStatus = enabled ? "enabled" : "disabled";

  if (existingLearningsAgent) {
    // Idempotent update: flip status if needed
    if (existingLearningsAgent.status !== targetStatus) {
      await updateBackgroundAgent(userId, existingLearningsAgent.id, {
        status: targetStatus,
      });
    }
    return { agentId: existingLearningsAgent.id, idempotent: true };
  }

  // Create a new built-in agent + triggers
  const agent = await createBackgroundAgent(userId, {
    name: "PR Review Learnings",
    description:
      "Extracts engineering learnings from merged pull requests and submitted PR reviews.",
    status: targetStatus,
    repoOwner,
    repoName,
    instructions: `${LEARNINGS_AGENT_MARKER} Extract actionable engineering learnings from merged pull requests and reviewer feedback for this repository.`,
    permissions: {
      github: {
        contents: "read",
        pullRequests: "read",
      },
    },
    outputMode: "none",
    composioToolkitSlugs: [],
    triggers: [
      {
        name: "Merged PR",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {
          actions: ["closed"],
          mergedOnly: true,
        },
      },
      {
        name: "PR Review Submitted",
        kind: "github.pull_request_review",
        status: "enabled",
        conditions: {
          actions: ["submitted"],
        },
      },
    ],
  });

  return { agentId: agent.id, idempotent: false };
}

/**
 * Disable the built-in learnings agent for a repo (non-destructive — status
 * flip only, no row deletion).
 */
export async function disableRepoLearningsAgent(
  userId: string,
  repoOwner: string,
  repoName: string,
): Promise<DisableRepoLearningsAgentResult> {
  const existing = await listRepoBackgroundAgents({
    userId,
    repoOwner,
    repoName,
  });

  const learningsAgent = existing.find((agent) => isLearningsAgent(agent));
  if (!learningsAgent) {
    return {};
  }

  await updateBackgroundAgent(userId, learningsAgent.id, {
    status: "disabled",
  });

  return { agentId: learningsAgent.id };
}

/**
 * Returns the current enable state and agentId for the learnings agent.
 */
export async function getRepoLearningsAgentStatus(
  userId: string,
  repoOwner: string,
  repoName: string,
): Promise<GetRepoLearningsAgentStatusResult> {
  const existing = await listRepoBackgroundAgents({
    userId,
    repoOwner,
    repoName,
  });

  const learningsAgent = existing.find((agent) => isLearningsAgent(agent));
  if (!learningsAgent) {
    return { enabled: false };
  }

  return {
    enabled: learningsAgent.status === "enabled",
    agentId: learningsAgent.id,
  };
}
