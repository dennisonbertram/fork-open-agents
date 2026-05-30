import "server-only";

import { z } from "zod";
import { getAppOctokit } from "@/lib/github/app";
import type { BackgroundAgentReadinessCheck } from "./readiness";

const requiredGitHubAppEvents = [
  "pull_request",
  "issues",
  "deployment_status",
] as const;

const requiredGitHubAppPermissions = {
  contents: "write",
  pull_requests: "write",
  issues: "read",
  deployments: "read",
  statuses: "read",
  metadata: "read",
} as const;

const githubAppMetadataSchema = z
  .object({
    slug: z.string().nullable().optional(),
    events: z.array(z.string()).optional(),
    permissions: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

function hasValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function permissionSatisfies(
  actual: string | undefined,
  required: "read" | "write",
): boolean {
  if (required === "read") {
    return actual === "read" || actual === "write";
  }
  return actual === "write";
}

export async function getGitHubAppWebhookReadinessCheck(): Promise<BackgroundAgentReadinessCheck> {
  const missingEnv = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "NEXT_PUBLIC_GITHUB_APP_SLUG",
  ].filter((name) => !hasValue(name));

  if (missingEnv.length > 0) {
    return {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: "missing",
      detail:
        "GitHub App credentials are required before webhook subscriptions can be verified.",
      missing: missingEnv,
    };
  }

  try {
    const response = await getAppOctokit().request("GET /app");
    const parsed = githubAppMetadataSchema.safeParse(response.data as unknown);
    if (!parsed.success) {
      return {
        id: "github_app_webhooks",
        label: "GitHub App webhooks",
        status: "missing",
        detail: "GitHub App metadata response could not be verified.",
        missing: ["github_app_metadata"],
      };
    }

    const events = new Set(parsed.data.events);
    const permissions = parsed.data.permissions ?? {};
    const missingEvents = requiredGitHubAppEvents
      .filter((event) => !events.has(event))
      .map((event) => `event:${event}`);
    const missingPermissions = Object.entries(requiredGitHubAppPermissions)
      .filter(
        ([permission, required]) =>
          !permissionSatisfies(permissions[permission], required),
      )
      .map(([permission, required]) => `permission:${permission}=${required}`);
    const missing = [...missingEvents, ...missingPermissions];

    return {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: missing.length === 0 ? "ready" : "missing",
      detail:
        missing.length === 0
          ? `GitHub App ${parsed.data.slug ?? "configured"} has the event subscriptions and repo permissions needed for background agents.`
          : "GitHub App must subscribe to PR, issue, and deployment-status events with the required repo permissions.",
      missing,
    };
  } catch (error) {
    console.warn("[background-agents] GitHub App webhook readiness failed", {
      errorKind: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: "missing",
      detail:
        "GitHub App webhook subscriptions and permissions could not be verified. Check App credentials and GitHub API access.",
      missing: ["github_app_metadata"],
    };
  }
}
