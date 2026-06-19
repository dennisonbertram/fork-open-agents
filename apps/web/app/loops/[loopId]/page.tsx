import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import { listTriggersForLoop } from "@/lib/background-agents/store";
import { LoopDetail } from "./loop-detail";

type LoopDetailPageProps = {
  params: Promise<{ loopId: string }>;
};

export const metadata: Metadata = {
  title: "Loop detail",
  description: "Agent loop configuration and run history.",
};

export default async function LoopDetailPage({ params }: LoopDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { loopId } = await params;
  const loop = await getOwnedAgentLoop({ userId: session.user.id, loopId });
  if (!loop) {
    notFound();
  }

  const triggers = await listTriggersForLoop(loopId);

  return (
    <LoopDetail
      loopId={loopId}
      initialLoopData={{
        loop,
        triggers: triggers.map((t) => ({
          id: t.id,
          kind: t.kind,
          status: t.status,
          conditions: t.conditions,
          schedule: t.schedule,
          createdAt: t.createdAt,
        })),
      }}
    />
  );
}
