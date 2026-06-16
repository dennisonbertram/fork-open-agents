import type { Metadata } from "next";
import { ArrowLeft, Bot } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { listAgentLoops } from "@/lib/agent-loops/store";
import { listRepoBackgroundAgents } from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { AgentsWindow } from "../dashboard-windows";
import { WorkflowsWindowView } from "../workflows-window";

export const metadata: Metadata = {
  title: "Project",
  description: "Agents and loops for this project.",
};

type ProjectPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoProjectPage({ params }: ProjectPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;

  // Agents and loops are project concerns (not GitHub repo data). Fetch with
  // independent failure isolation so one source can't break the page.
  const loopsEnabled = isAgentLoopsEnabled();
  const [agentsResult, loopsResult] = await Promise.allSettled([
    listRepoBackgroundAgents({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
    }),
    loopsEnabled
      ? listAgentLoops(session.user.id, { repoOwner: owner, repoName: repo })
      : Promise.resolve([]),
  ]);

  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const loops = loopsResult.status === "fulfilled" ? loopsResult.value : [];

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Project header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Project</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/repos/${owner}/${repo}`}>
                <ArrowLeft className="h-4 w-4" />
                Repo dashboard
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/background-agents">
                <Bot className="h-4 w-4" />
                Agents settings
              </Link>
            </Button>
          </div>
        </div>

        {/* Project windows: agents + loops */}
        <div className="space-y-4" role="region" aria-label="Project">
          <AgentsWindow agents={agents} />
          {loopsEnabled ? (
            <WorkflowsWindowView
              loops={loops}
              repoOwner={owner}
              repoName={repo}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
