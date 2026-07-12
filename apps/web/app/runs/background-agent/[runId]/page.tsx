import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackgroundRunDetail } from "@/app/background-runs/[runId]/background-run-detail";
import { loadOwnedBackgroundRunDetail } from "@/lib/runs/detail-loaders";
import { getServerSession } from "@/lib/session/get-server-session";

type CanonicalBackgroundRunPageProps = {
  params: Promise<{ runId: string }>;
};

export const metadata: Metadata = {
  title: "Automation run",
  description: "Background Automation run evidence.",
};

export default async function CanonicalBackgroundRunPage({
  params,
}: CanonicalBackgroundRunPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { runId } = await params;
  const detail = await loadOwnedBackgroundRunDetail({
    userId: session.user.id,
    runId,
  });
  if (!detail) notFound();

  return <BackgroundRunDetail initialData={detail} variant="canonical" />;
}
