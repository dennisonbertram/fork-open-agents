import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewAgentBuilder } from "@/app/repos/[owner]/[repo]/agents/new/new-agent-builder";
import { getServerSession } from "@/lib/session/get-server-session";
import { AutomationRepositoryPicker } from "./repository-picker";

export const metadata: Metadata = {
  title: "New single-step Automation",
  description: "Create a repository-scoped coding Automation.",
};

type NewAutomationPageProps = {
  searchParams: Promise<{ repoOwner?: string; repoName?: string }>;
};

export default async function NewAutomationPage({
  searchParams,
}: NewAutomationPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const search = await searchParams;
  const repoOwner = search.repoOwner?.trim();
  const repoName = search.repoName?.trim();
  const hasRepository = Boolean(repoOwner && repoName);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <header className="border-b border-border pb-4">
          <Link
            href="/automations"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Automations
          </Link>
          <h1 className="mt-2 text-balance text-2xl font-semibold">
            New single-step Automation
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Save disabled, review fail-closed readiness, enable and save, then
            run a manual production-dispatcher test.
          </p>
          <p className="mt-2 text-pretty text-xs text-muted-foreground">
            Trigger → Conditions → Instructions → Permissions → Verification →
            Output → Review
          </p>
        </header>

        {hasRepository ? (
          <NewAgentBuilder
            owner={repoOwner!}
            repo={repoName!}
            surface="automation"
          />
        ) : (
          <AutomationRepositoryPicker />
        )}
      </div>
    </main>
  );
}
