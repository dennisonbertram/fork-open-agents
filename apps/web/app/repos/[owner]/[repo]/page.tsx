import type { Metadata } from "next";
import { Bot, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  listBackgroundAgentRuns,
  listRepoBackgroundAgents,
} from "@/lib/background-agents/store";
import { getRepoDashboardData } from "@/lib/github/repo-dashboard";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  OverviewWindow,
  AgentsWindow,
  ActivityWindow,
} from "./dashboard-windows";
import {
  PullRequestsWindow,
  IssuesWindow,
  ActionsWindow,
} from "./github-windows";

export const metadata: Metadata = {
  title: "Repo dashboard",
  description: "Repo dashboard for project agents and activity.",
};

type RepoDashboardPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoDashboardPage({
  params,
}: RepoDashboardPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;
  const [agents, runs, dashboardData] = await Promise.all([
    listRepoBackgroundAgents({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
    }),
    listBackgroundAgentRuns({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
      limit: 50,
    }),
    getRepoDashboardData({
      userId: session.user.id,
      owner,
      repo,
    }),
  ]);

  const { prSummary, issueSummary, actionsSummary } = dashboardData;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Repo header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Repo dashboard</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`https://github.com/${owner}/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${owner}/${repo} on GitHub`}
              >
                <ExternalLink className="h-4 w-4" />
                GitHub
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/background-agents">
                <Bot className="h-4 w-4" />
                Agents settings
              </Link>
            </Button>
          </div>
        </div>

        {/* Dashboard windows grid */}
        <div className="space-y-4" role="region" aria-label="Repo dashboard">
          <OverviewWindow
            agentCount={agents.length}
            runCount={runs.length}
            repoOwner={owner}
            repoName={repo}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <PullRequestsWindow summary={prSummary} owner={owner} repo={repo} />
            <IssuesWindow summary={issueSummary} owner={owner} repo={repo} />
            <ActionsWindow summary={actionsSummary} owner={owner} repo={repo} />
          </div>

          <AgentsWindow agents={agents} />
          <ActivityWindow runs={runs} />
        </div>
      </div>
    </main>
  );
}
