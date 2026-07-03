import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { resolveRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";
import { getRepositorySettings } from "@/lib/db/repository-settings";
import { getVercelProjectLinkByRepo } from "@/lib/db/vercel-project-links";
import { hasGitHubAccount } from "@/lib/github/users";
import { getUserGitHubToken } from "@/lib/github/token";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { getRepoToolsEffectiveStatuses } from "@/lib/composio/repo-tools-page-data";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { RepoSettingsSection } from "./repo-settings-section";
import type { GitHubConnectionStatusResponse } from "@/lib/github/status";

export const metadata: Metadata = {
  title: "Repository settings",
  description: "Per-repo session defaults and integration settings.",
};

// Next 15 async params
type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

async function getGitHubStatusForUser(
  userId: string,
): Promise<GitHubConnectionStatusResponse> {
  const [linked, installations] = await Promise.all([
    hasGitHubAccount(userId),
    getInstallationsByUserId(userId),
  ]);

  if (!linked) {
    return {
      status: "not_connected",
      reason: null,
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: installations.length,
    };
  }

  const token = await getUserGitHubToken(userId);
  if (!token) {
    return {
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: null,
    };
  }

  return {
    status: "connected",
    reason: null,
    hasInstallations: installations.length > 0,
    syncedInstallationsCount: installations.length,
  };
}

export default async function RepoSettingsPage({ params }: PageProps) {
  const { owner: rawOwner, repo: rawRepo } = await params;

  const owner = decodeURIComponent(rawOwner);
  const repo = decodeURIComponent(rawRepo);

  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;

  const [resolved, raw, vercelLink, githubStatus, toolStatusesResult] =
    await Promise.all([
      resolveRepoDefaults({ userId, repoOwner: owner, repoName: repo }),
      getRepositorySettings({ userId, repoOwner: owner, repoName: repo }),
      getVercelProjectLinkByRepo(userId, owner, repo),
      getGitHubStatusForUser(userId),
      getRepoToolsEffectiveStatuses({
        userId,
        repoOwner: owner,
        repoName: repo,
      }).catch(() => []),
    ]);

  return (
    <>
      <SettingsPageHeader
        title={`${owner}/${repo}`}
        description="Per-repository defaults for sessions, runtime, and integrations."
      />
      <RepoSettingsSection
        owner={owner}
        repo={repo}
        resolved={resolved}
        raw={raw ?? null}
        integrations={{
          github: githubStatus,
          vercel: vercelLink,
          composioHref: "/settings/composio",
        }}
        toolStatuses={toolStatusesResult}
      />
    </>
  );
}
