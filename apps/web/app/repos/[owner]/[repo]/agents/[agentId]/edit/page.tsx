import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getOwnedBackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { AgentEditForm } from "./agent-edit-form";

type AgentEditPageProps = {
  params: Promise<{ owner: string; repo: string; agentId: string }>;
};

export const metadata: Metadata = {
  title: "Edit agent",
  description: "Edit background agent configuration.",
};

export default async function AgentEditPage({ params }: AgentEditPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo, agentId } = await params;

  const agent = await getOwnedBackgroundAgentWithTriggers({
    userId: session.user.id,
    agentId,
  });

  if (!agent) {
    notFound();
  }

  const detailHref = `/repos/${owner}/${repo}/agents/${agentId}`;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/repos/${owner}/${repo}/agents`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {owner}/{repo} agents
              </Link>
              <span className="text-muted-foreground">/</span>
              <Link
                href={detailHref}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {agent.name}
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-semibold">Edit</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold">
              Edit agent:{" "}
              <span className="text-muted-foreground">{agent.name}</span>
            </h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={detailHref}>Cancel</Link>
          </Button>
        </div>

        {/* Edit form */}
        <AgentEditForm agent={agent} owner={owner} repo={repo} />
      </div>
    </main>
  );
}
