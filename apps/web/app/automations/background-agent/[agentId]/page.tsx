import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AgentDetailContent } from "@/app/repos/[owner]/[repo]/agents/[agentId]/page";
import {
  getOwnedBackgroundAgentWithTriggers,
  listBackgroundAgentRuns,
} from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";

type AutomationDetailPageProps = {
  params: Promise<{ agentId: string }>;
};

export const metadata: Metadata = {
  title: "Single-step Automation",
  description: "Automation configuration and run evidence.",
};

export default async function AutomationDetailPage({
  params,
}: AutomationDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { agentId } = await params;
  const agent = await getOwnedBackgroundAgentWithTriggers({
    userId: session.user.id,
    agentId,
  });

  if (!agent) notFound();

  const runs = await listBackgroundAgentRuns({
    userId: session.user.id,
    repoOwner: agent.repoOwner,
    repoName: agent.repoName,
    limit: 20,
  });

  return (
    <AgentDetailContent
      agent={agent}
      agentRuns={runs.filter((run) => run.agentId === agent.id)}
      owner={agent.repoOwner}
      repo={agent.repoName}
      surface="automation"
    />
  );
}
