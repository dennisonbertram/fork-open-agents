import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoopCreateExperience } from "@/app/loops/loop-create-experience";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { getServerSession } from "@/lib/session/get-server-session";

export const metadata: Metadata = {
  title: "New multi-step Automation",
  description: "Create an advanced durable coding Automation.",
};

type NewLoopAutomationPageProps = {
  searchParams: Promise<{ repoOwner?: string; repoName?: string }>;
};

export default async function NewLoopAutomationPage({
  searchParams,
}: NewLoopAutomationPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { repoOwner, repoName } = await searchParams;
  const enabled = isAgentLoopsEnabled();

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
            New multi-step Automation
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Start with a linear template, review each Step, then activate only
            after configuration and execution readiness are both clear.
          </p>
        </header>

        {enabled ? (
          <LoopCreateExperience
            initialRepoOwner={repoOwner}
            initialRepoName={repoName}
            surface="automation"
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/20 p-6">
            <p className="text-sm font-medium">
              Multi-step Automations are disabled
            </p>
            <p className="mt-1 text-pretty text-xs text-muted-foreground">
              This deployment has not enabled the multi-step Automation runtime.
              Existing single-step Automations remain available.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
