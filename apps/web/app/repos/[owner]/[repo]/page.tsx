import type { Metadata } from "next";
import { Bot, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  listBackgroundAgentRuns,
  listRepoBackgroundAgents,
} from "@/lib/background-agents/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { listAgentLoops } from "@/lib/agent-loops/store";
import { getRepoDashboardData } from "@/lib/github/repo-dashboard";
import { getServerSession } from "@/lib/session/get-server-session";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { WorkflowsWindowView } from "./workflows-window";

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

  // Fetch all data sources in parallel with independent failure isolation.
  // A throw in agents/runs/dashboard/loops must never break the entire page render.
  const loopsEnabled = isAgentLoopsEnabled();
  const [agentsResult, runsResult, dashboardDataResult, loopsResult] =
    await Promise.allSettled([
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
      loopsEnabled
        ? listAgentLoops(session.user.id, { repoOwner: owner, repoName: repo })
        : Promise.resolve([]),
    ]);

  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const runs = runsResult.status === "fulfilled" ? runsResult.value : [];
  const loops = loopsResult.status === "fulfilled" ? loopsResult.value : [];

  const dashboardData =
    dashboardDataResult.status === "fulfilled"
      ? dashboardDataResult.value
      : {
          prSummary: { ok: false, errorKind: "provider_unavailable" } as const,
          issueSummary: {
            ok: false,
            errorKind: "provider_unavailable",
          } as const,
          actionsSummary: {
            ok: false,
            errorKind: "provider_unavailable",
          } as const,
        };

  const { prSummary, issueSummary, actionsSummary } = dashboardData;

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
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

          <Tabs defaultValue="pull-requests" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="pull-requests" className="flex-1">
                Pull Requests
              </TabsTrigger>
              <TabsTrigger value="issues" className="flex-1">
                Issues
              </TabsTrigger>
              <TabsTrigger value="actions" className="flex-1">
                Actions
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pull-requests">
              <PullRequestsWindow summary={prSummary} owner={owner} repo={repo} />
            </TabsContent>
            <TabsContent value="issues">
              <IssuesWindow summary={issueSummary} owner={owner} repo={repo} />
            </TabsContent>
            <TabsContent value="actions">
              <ActionsWindow summary={actionsSummary} owner={owner} repo={repo} />
            </TabsContent>
          </Tabs>

          <AgentsWindow agents={agents} />
          {loopsEnabled ? (
            <WorkflowsWindowView
              loops={loops}
              repoOwner={owner}
              repoName={repo}
            />
          ) : null}
          <ActivityWindow runs={runs} />
        </div>
      </div>
    </main>
  );
}
