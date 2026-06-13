import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link
              href={`/repos/${owner}/${repo}`}
              className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {owner}/{repo}
            </Link>
            <h1 className="text-2xl font-semibold">Loops</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-step agent workflows that run against{" "}
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
