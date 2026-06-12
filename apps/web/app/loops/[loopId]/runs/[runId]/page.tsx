import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  getAgentLoopRunWithLoop,
  listAgentLoopEvents,
  listStepRunsForRun,
} from "@/lib/agent-loops/store";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { RunDetail } from "./run-detail";

type RunDetailPageProps = {
  params: Promise<{ loopId: string; runId: string }>;
};

export const metadata: Metadata = {
  title: "Loop run",
  description: "Agent loop run timeline and evidence.",
};

export default async function LoopRunDetailPage({
  params,
}: RunDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { runId } = await params;
  const row = await getAgentLoopRunWithLoop(runId);

  if (!row) {
    notFound();
  }

  // Ownership check — do not leak existence
  if (row.run.userId !== session.user.id) {
    notFound();
  }

  const [steps, events] = await Promise.all([
    listStepRunsForRun(runId),
    listAgentLoopEvents(runId),
  ]);

  const initialData: GetAgentLoopRunDetailResponse = {
    run: row.run,
    loop: {
      id: row.loop.id,
      name: row.loop.name,
      repoOwner: row.loop.repoOwner,
      repoName: row.loop.repoName,
      guardrails: row.loop.guardrails,
    },
    steps,
    events,
  };

  return <RunDetail initialData={initialData} />;
}
