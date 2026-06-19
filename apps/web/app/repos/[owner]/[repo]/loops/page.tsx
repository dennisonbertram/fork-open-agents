import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { LoopsList } from "@/app/loops/loops-list";

export const metadata: Metadata = {
  title: "Loops",
  description: "Agent Loops for this repository.",
};

type RepoLoopsPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoLoopsPage({ params }: RepoLoopsPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;
  const enabled = isAgentLoopsEnabled();
  const newHref = `/loops/new?repoOwner=${encodeURIComponent(owner)}&repoName=${encodeURIComponent(repo)}`;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <nav
              aria-label="Loop breadcrumb"
              className="mb-3 flex min-w-0 items-center gap-1.5 text-sm"
            >
              <Link
                href="/sessions"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                Workspace
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Link
                href={`/repos/${owner}/${repo}`}
                className="min-w-0 truncate font-mono text-muted-foreground hover:text-foreground"
              >
                {owner}/{repo}
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-medium">Loops</span>
            </nav>
            <h1 className="text-2xl font-semibold">Loops</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-step agent loops that run against{" "}
              <span className="font-mono">
                {owner}/{repo}
              </span>
              .
            </p>
          </div>
          {enabled ? (
            <Link
              href={newHref}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/20"
            >
              <Plus className="h-4 w-4" />
              New loop
            </Link>
          ) : null}
        </div>
        <LoopsList createEnabled={enabled} repoOwner={owner} repoName={repo} />
      </div>
    </main>
  );
}
