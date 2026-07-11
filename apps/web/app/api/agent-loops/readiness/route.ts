import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getAgentLoopRepoAccess,
  getAgentLoopsRepoPolicy,
  isAgentLoopsEnabled,
} from "@/lib/agent-loops/config";
import {
  getBackgroundAgentRepoAccess,
  getBackgroundAgentsRepoPolicy,
} from "@/lib/background-agents/config";
import type {
  AgentLoopsReadinessCheck,
  AgentLoopsReadinessResponse,
} from "../types";

/**
 * GET /api/agent-loops/readiness?owner=<owner>&repo=<repo>
 *
 * Returns the readiness state of the agent loops feature.
 * Mirrors the background-agents readiness pattern:
 *   - Named checks with status/missing fields
 *   - Never exposes secret values
 *
 * When `owner` and `repo` query params are both present, an additional
 * `repo_access` check is appended reporting whether THIS repository is
 * allowed under the configured allowlist (isAgentLoopRepoAllowed) — used by
 * the create-form precheck (#767) so a user sees "not enabled for loops on
 * this deployment" before submitting, instead of a first-run 403. Omitting
 * owner/repo keeps the response identical to the pre-#767 shape.
 */
export async function GET(req?: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const enabled = isAgentLoopsEnabled();
  const repoPolicy = getAgentLoopsRepoPolicy();
  const repoPolicyReady =
    repoPolicy.state === "wildcard" || repoPolicy.state === "list";
  const repoPolicyDetail = (() => {
    switch (repoPolicy.state) {
      case "wildcard":
        return "AGENT_LOOPS_ALLOWED_REPOS explicitly allows every repository with *.";
      case "list":
        return `AGENT_LOOPS_ALLOWED_REPOS is configured with ${repoPolicy.entries.size} entr${repoPolicy.entries.size === 1 ? "y" : "ies"}.`;
      case "invalid":
        return "AGENT_LOOPS_ALLOWED_REPOS contains invalid entries; loop dispatch is denied until it is corrected.";
      case "missing":
        return "AGENT_LOOPS_ALLOWED_REPOS is required; loop dispatch is denied until it is configured.";
    }
  })();
  const sharedWebhookPolicy = getBackgroundAgentsRepoPolicy();
  const sharedWebhookPolicyReady =
    sharedWebhookPolicy.state === "wildcard" ||
    sharedWebhookPolicy.state === "list";
  const sharedWebhookPolicyDetail = (() => {
    switch (sharedWebhookPolicy.state) {
      case "wildcard":
        return "BACKGROUND_AGENTS_ALLOWED_REPOS explicitly allows shared loop webhooks for every repository with *.";
      case "list":
        return `BACKGROUND_AGENTS_ALLOWED_REPOS is configured with ${sharedWebhookPolicy.entries.size} entr${sharedWebhookPolicy.entries.size === 1 ? "y" : "ies"} for shared loop webhooks.`;
      case "invalid":
        return "BACKGROUND_AGENTS_ALLOWED_REPOS contains invalid entries; shared loop webhook dispatch is denied until it is corrected.";
      case "missing":
        return "BACKGROUND_AGENTS_ALLOWED_REPOS is required for shared loop webhooks; dispatch is denied until it is configured.";
    }
  })();

  // Check 1: feature flag
  // Check 2: repo allowlist
  const checks: AgentLoopsReadinessCheck[] = [
    {
      id: "feature_flag",
      label: "Feature flag",
      status: enabled ? "ready" : "disabled",
      detail:
        "AGENT_LOOPS_ENABLED gates trigger dispatch and run creation for agent loops.",
      missing: enabled ? [] : ["AGENT_LOOPS_ENABLED"],
    },
    {
      id: "repo_allowlist",
      label: "Repository allowlist",
      status: repoPolicyReady ? "ready" : "missing",
      detail: repoPolicyDetail,
      missing: repoPolicyReady ? [] : ["AGENT_LOOPS_ALLOWED_REPOS"],
    },
    {
      id: "shared_webhook_allowlist",
      label: "Shared webhook allowlist",
      status: sharedWebhookPolicyReady ? "ready" : "missing",
      detail: sharedWebhookPolicyDetail,
      missing: sharedWebhookPolicyReady
        ? []
        : ["BACKGROUND_AGENTS_ALLOWED_REPOS"],
    },
  ];

  const url = req ? new URL(req.url) : null;
  const owner = url?.searchParams.get("owner")?.trim();
  const repo = url?.searchParams.get("repo")?.trim();

  if (owner && repo) {
    const access = getAgentLoopRepoAccess(owner, repo);
    const configurationRefused =
      !access.allowed &&
      (access.reason === "repo_allowlist_unconfigured" ||
        access.reason === "repo_allowlist_invalid");
    checks.push({
      id: "repo_access",
      label: "This repository",
      status: access.allowed
        ? "ready"
        : configurationRefused
          ? "missing"
          : "disabled",
      detail: access.allowed
        ? `${owner}/${repo} is enabled for loops on this deployment.`
        : configurationRefused
          ? "Loop repository access cannot be evaluated until AGENT_LOOPS_ALLOWED_REPOS is valid."
          : `${owner}/${repo} isn't enabled for loops on this deployment.`,
      missing: access.allowed ? [] : ["AGENT_LOOPS_ALLOWED_REPOS"],
    });

    const sharedWebhookAccess = getBackgroundAgentRepoAccess(owner, repo);
    const sharedWebhookConfigurationRefused =
      !sharedWebhookAccess.allowed &&
      (sharedWebhookAccess.reason === "repo_allowlist_unconfigured" ||
        sharedWebhookAccess.reason === "repo_allowlist_invalid");
    checks.push({
      id: "shared_webhook_repo_access",
      label: "Shared webhooks for this repository",
      status: sharedWebhookAccess.allowed
        ? "ready"
        : sharedWebhookConfigurationRefused
          ? "missing"
          : "disabled",
      detail: sharedWebhookAccess.allowed
        ? `${owner}/${repo} is enabled for shared loop webhooks on this deployment.`
        : sharedWebhookConfigurationRefused
          ? "Shared loop webhook access cannot be evaluated until BACKGROUND_AGENTS_ALLOWED_REPOS is valid."
          : `${owner}/${repo} isn't enabled for shared loop webhooks on this deployment.`,
      missing: sharedWebhookAccess.allowed
        ? []
        : ["BACKGROUND_AGENTS_ALLOWED_REPOS"],
    });
  }

  const response: AgentLoopsReadinessResponse = {
    enabled,
    checks,
  };

  return Response.json(response);
}
