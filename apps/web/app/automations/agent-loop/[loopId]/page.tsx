import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LoopDetail } from "@/app/loops/[loopId]/loop-detail";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import { listTriggersForLoop } from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";

type LoopAutomationPageProps = {
  params: Promise<{ loopId: string }>;
};

export const metadata: Metadata = {
  title: "Multi-step Automation",
  description: "Multi-step Automation definition and Run history.",
};

export default async function LoopAutomationPage({
  params,
}: LoopAutomationPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { loopId } = await params;
  const loop = await getOwnedAgentLoop({ userId: session.user.id, loopId });
  if (!loop) notFound();

  const triggers = await listTriggersForLoop(loopId);
  return (
    <LoopDetail
      loopId={loopId}
      surface="automation"
      initialLoopData={{
        loop,
        triggers: triggers.map((trigger) => ({
          id: trigger.id,
          kind: trigger.kind,
          status: trigger.status,
          conditions: trigger.conditions,
          schedule: trigger.schedule,
          createdAt: trigger.createdAt,
        })),
      }}
    />
  );
}
