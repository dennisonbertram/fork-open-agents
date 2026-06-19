import { z } from "zod";
import {
  getAppOctokit,
  isGitHubAppConfigured,
  withScopedInstallationOctokit,
} from "@/lib/github/app";
import { classifyActionsReadError } from "./errors";
import type { DashboardErrorKind } from "../repo-dashboard";

export type ActionsManagerReadinessVerdict = {
  status: "ready" | "action-needed" | "unavailable" | "error";
  headline: string;
  subtext?: string;
  actionHref?: string;
  actionLabel?: string;
  errorKind?: DashboardErrorKind;
};

const appMetadataSchema = z
  .object({
    slug: z.string().nullable().optional(),
    permissions: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

function permissionSatisfies(
  actual: string | undefined,
  required: "read" | "write",
): boolean {
  if (required === "read") {
    return actual === "read" || actual === "write";
  }
  return actual === "write";
}

function appInstallSettingsUrl(installationId: number, slug?: string | null) {
  if (slug) {
    return `https://github.com/apps/${slug}/installations/new/permissions`;
  }
  return `https://github.com/settings/installations/${installationId}`;
}

export async function getActionsManagerReadinessCheck(params: {
  installationId: number;
  repositoryId: number;
}): Promise<ActionsManagerReadinessVerdict> {
  if (!isGitHubAppConfigured()) {
    return {
      status: "unavailable",
      headline: "GitHub App is not configured",
      subtext: "Actions can be shown after the GitHub App credentials are set.",
      errorKind: "installation_missing",
    };
  }

  try {
    const response = await getAppOctokit().request("GET /app");
    const parsed = appMetadataSchema.safeParse(response.data as unknown);
    if (!parsed.success) {
      return {
        status: "error",
        headline: "Could not verify GitHub App permissions",
        subtext: "GitHub returned an unexpected App metadata response.",
        errorKind: "provider_unavailable",
      };
    }

    const appPermissions = parsed.data.permissions ?? {};
    if (!permissionSatisfies(appPermissions.actions, "read")) {
      return {
        status: "action-needed",
        headline: "Re-authorize the GitHub App to view Actions",
        subtext: "This repo needs the GitHub App's Actions read permission.",
        actionHref: appInstallSettingsUrl(
          params.installationId,
          parsed.data.slug,
        ),
        actionLabel: "Open GitHub App settings",
        errorKind: "app_no_actions_permission",
      };
    }

    try {
      await withScopedInstallationOctokit({
        installationId: params.installationId,
        repositoryId: params.repositoryId,
        permissions: { actions: "read", metadata: "read" },
        operation: async () => undefined,
      });
    } catch (error) {
      const errorKind = classifyActionsReadError(error);
      if (
        errorKind === "app_no_actions_permission" ||
        errorKind === "repo_access_denied"
      ) {
        return {
          status: "action-needed",
          headline: "Re-authorize the GitHub App to view Actions",
          subtext:
            "This installation has not granted Actions read permission for this repo.",
          actionHref: appInstallSettingsUrl(
            params.installationId,
            parsed.data.slug,
          ),
          actionLabel: "Open GitHub App settings",
          errorKind: "app_no_actions_permission",
        };
      }

      return {
        status: "error",
        headline: "Could not verify Actions access",
        subtext: "GitHub App permissions could not be checked right now.",
        errorKind,
      };
    }

    return {
      status: "ready",
      headline: "Connected — Actions read available",
      subtext: "Workflow runs, jobs, and logs can be viewed for this repo.",
    };
  } catch {
    return {
      status: "error",
      headline: "Could not verify Actions access",
      subtext: "GitHub App permissions could not be checked right now.",
      errorKind: "provider_unavailable",
    };
  }
}
