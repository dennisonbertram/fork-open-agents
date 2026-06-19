import "server-only";

import { z } from "zod";
import {
  getAppOctokit,
  isGitHubAppConfigured,
  withScopedInstallationOctokit,
} from "@/lib/github/app";
import { classifySecretsError, type GithubSecretsErrorKind } from "./errors";

export type SecretsManagerReadinessVerdict = {
  status: "ready" | "action-needed" | "unavailable" | "error";
  headline: string;
  subtext?: string;
  actionHref?: string;
  actionLabel?: string;
  errorKind?: GithubSecretsErrorKind;
  canRead: boolean;
  canWrite: boolean;
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

function unavailable(errorKind: GithubSecretsErrorKind = "no_installation") {
  return {
    status: "unavailable" as const,
    headline: "GitHub App is not configured",
    subtext: "Secrets can be shown after the GitHub App credentials are set.",
    errorKind,
    canRead: false,
    canWrite: false,
  };
}

export async function getSecretsManagerReadinessCheck(params: {
  installationId: number;
  repositoryId: number;
}): Promise<SecretsManagerReadinessVerdict> {
  if (!isGitHubAppConfigured()) {
    return unavailable();
  }

  try {
    const response = await getAppOctokit().request("GET /app");
    const parsed = appMetadataSchema.safeParse(response.data as unknown);
    if (!parsed.success) {
      return {
        status: "error",
        headline: "Could not verify GitHub App permissions",
        subtext: "GitHub returned an unexpected App metadata response.",
        errorKind: "github_error",
        canRead: false,
        canWrite: false,
      };
    }

    const appPermissions = parsed.data.permissions ?? {};
    const canRead = permissionSatisfies(appPermissions.secrets, "read");
    const canWrite = permissionSatisfies(appPermissions.secrets, "write");
    const actionHref = appInstallSettingsUrl(
      params.installationId,
      parsed.data.slug,
    );

    if (!canRead) {
      return {
        status: "action-needed",
        headline: "Re-authorize the GitHub App to manage Secrets",
        subtext: "This repo needs the GitHub App's Secrets read permission.",
        actionHref,
        actionLabel: "Open GitHub App settings",
        errorKind: "app_no_secrets_permission",
        canRead: false,
        canWrite: false,
      };
    }

    try {
      await withScopedInstallationOctokit({
        installationId: params.installationId,
        repositoryId: params.repositoryId,
        permissions: { metadata: "read", secrets: "read" },
        operation: async () => undefined,
      });
    } catch (error) {
      return {
        status: "action-needed",
        headline: "Re-authorize the GitHub App to manage Secrets",
        subtext:
          "This installation has not granted Secrets permission for this repo.",
        actionHref,
        actionLabel: "Open GitHub App settings",
        errorKind: classifySecretsError(error),
        canRead: false,
        canWrite: false,
      };
    }

    if (!canWrite) {
      return {
        status: "action-needed",
        headline: "Re-authorize the GitHub App to manage Secrets",
        subtext: "This repo needs the GitHub App's Secrets write permission.",
        actionHref,
        actionLabel: "Open GitHub App settings",
        errorKind: "app_no_secrets_permission",
        canRead: true,
        canWrite: false,
      };
    }

    return {
      status: "ready",
      headline: "Connected - Secrets read/write available",
      subtext: "Repository secrets can be viewed and managed for this repo.",
      canRead: true,
      canWrite: true,
    };
  } catch {
    return {
      status: "error",
      headline: "Could not verify Secrets access",
      subtext: "GitHub App permissions could not be checked right now.",
      errorKind: "github_error",
      canRead: false,
      canWrite: false,
    };
  }
}
