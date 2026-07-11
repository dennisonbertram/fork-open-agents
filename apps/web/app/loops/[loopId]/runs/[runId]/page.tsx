import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { loadOwnedLoopRunDetail } from "@/lib/runs/detail-loaders";
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
  const initialData = await loadOwnedLoopRunDetail({
    userId: session.user.id,
    runId,
  });
  if (!initialData) notFound();

  return <RunDetail initialData={initialData} />;
}
