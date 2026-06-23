import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { NewAgentBuilder } from "./new-agent-builder";

type NewAgentPageProps = {
  params: Promise<{ owner: string; repo: string }>;
  searchParams?: Promise<{ ai?: string; prompt?: string }>;
};

export const metadata: Metadata = {
  title: "New agent",
  description: "Create a new background agent for this repository.",
};

export default async function NewAgentPage({
  params,
  searchParams,
}: NewAgentPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;
  const resolvedSearchParams = await searchParams;
  const aiPrompt =
    resolvedSearchParams?.ai === "true"
      ? (resolvedSearchParams.prompt?.trim() ?? null)
      : null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {/* Header */}
        <div className="border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Link
              href={`/repos/${owner}/${repo}/agents`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {owner}/{repo} agents
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-semibold">New agent</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">New agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New agents start off — save, test, then turn on.
          </p>
        </div>

        {/* Builder — template-first, then spec editor */}
        <NewAgentBuilder owner={owner} repo={repo} aiPrompt={aiPrompt} />
      </div>
    </main>
  );
}
