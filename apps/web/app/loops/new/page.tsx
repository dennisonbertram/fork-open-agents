import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { LoopCreateExperience } from "../loop-create-experience";

export const metadata: Metadata = {
  title: "New loop",
  description: "Create a new Agent Loop.",
};

type NewLoopPageProps = {
  searchParams: Promise<{ repoOwner?: string; repoName?: string }>;
};

export default async function NewLoopPage({ searchParams }: NewLoopPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const enabled = isAgentLoopsEnabled();
  const { repoOwner, repoName } = await searchParams;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <Link
            href="/loops"
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Loops
          </Link>
          <h1 className="text-2xl font-semibold">New loop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start from a template, describe it in plain English, or build it
            yourself.
          </p>
        </div>
        {enabled ? (
          <LoopCreateExperience
            initialRepoOwner={repoOwner}
            initialRepoName={repoName}
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/20 p-6">
            <p className="text-sm font-medium">Loops are disabled</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Agent Loops are not enabled in this deployment. Set{" "}
              <code className="font-mono">AGENT_LOOPS_ENABLED=true</code> to
              enable them.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
