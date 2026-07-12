import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadOwnedBackgroundRunDetail } from "@/lib/runs/detail-loaders";
import { getServerSession } from "@/lib/session/get-server-session";
import { BackgroundRunDetail } from "./background-run-detail";

type BackgroundRunPageProps = {
  params: Promise<{ runId: string }>;
};

export const metadata: Metadata = {
  title: "Background run",
  description: "Background agent run evidence.",
};

export default async function BackgroundRunPage({
  params,
}: BackgroundRunPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { runId } = await params;
  const initialData = await loadOwnedBackgroundRunDetail({
    userId: session.user.id,
    runId,
  });
  if (!initialData) {
    notFound();
  }

  return <BackgroundRunDetail initialData={initialData} />;
}
