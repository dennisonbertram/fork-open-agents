import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOwnedBackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { canonicalBackgroundAutomationDetailUrl } from "@/lib/automations/definition-routes";
import { getServerSession } from "@/lib/session/get-server-session";
import { AutomationAgentEditExperience } from "./automation-agent-edit-experience";

type AutomationEditPageProps = {
  params: Promise<{ agentId: string }>;
};

export const metadata: Metadata = {
  title: "Edit single-step Automation",
  description: "Edit a repository-scoped coding Automation.",
};

export default async function AutomationEditPage({
  params,
}: AutomationEditPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { agentId } = await params;
  const agent = await getOwnedBackgroundAgentWithTriggers({
    userId: session.user.id,
    agentId,
  });

  if (!agent) notFound();

  const detailHref = canonicalBackgroundAutomationDetailUrl(agent.id);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <header className="border-b border-border pb-4">
          <Link
            href={detailHref}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {agent.name}
          </Link>
          <h1 className="mt-2 text-balance text-2xl font-semibold">
            Edit single-step Automation
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {agent.repoOwner}/{agent.repoName}
          </p>
        </header>

        <AutomationAgentEditExperience agent={agent} />
      </div>
    </main>
  );
}
