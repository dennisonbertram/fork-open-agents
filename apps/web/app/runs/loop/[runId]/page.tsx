import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RunDetail } from "@/app/loops/[loopId]/runs/[runId]/run-detail";
import { loadOwnedLoopRunDetail } from "@/lib/runs/detail-loaders";
import { getServerSession } from "@/lib/session/get-server-session";

type CanonicalLoopRunPageProps = {
  params: Promise<{ runId: string }>;
};

export const metadata: Metadata = {
  title: "Automation run",
  description: "Multi-step Automation run evidence.",
};

export default async function CanonicalLoopRunPage({
  params,
}: CanonicalLoopRunPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { runId } = await params;
  const detail = await loadOwnedLoopRunDetail({
    userId: session.user.id,
    runId,
  });
  if (!detail) notFound();

  return <RunDetail initialData={detail} variant="canonical" />;
}
