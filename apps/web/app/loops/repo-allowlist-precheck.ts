/**
 * repo-allowlist-precheck.ts — maps a GET /api/agent-loops/readiness
 * response (with owner/repo query params, #767) to the create-form's
 * blocking message, so a user sees "This repository isn't enabled for
 * loops on this deployment." before submit instead of a first-run 403.
 */

import type { AgentLoopsReadinessResponse } from "@/app/api/agent-loops/types";

const BLOCK_MESSAGE =
  "This repository isn't enabled for loops on this deployment.";

/**
 * Returns the blocking message when the readiness response's repo_access
 * check reports the repo isn't allowed, or null when it's ready (or the
 * check is absent, e.g. readiness was called without owner/repo).
 */
export function getRepoAllowlistBlockMessage(
  readiness: AgentLoopsReadinessResponse,
): string | null {
  const repoCheck = readiness.checks.find((c) => c.id === "repo_access");
  if (!repoCheck || repoCheck.status === "ready") {
    return null;
  }
  return BLOCK_MESSAGE;
}
