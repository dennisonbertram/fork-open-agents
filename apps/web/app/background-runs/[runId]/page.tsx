import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getOwnedBackgroundAgentRun,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
} from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  BackgroundRunDetail,
  type BackgroundRunDetailData,
} from "./background-run-detail";

type BackgroundRunPageProps = {
  params: Promise<{ runId: string }>;
};

export const metadata: Metadata = {
  title: "Background run",
  description: "Background agent run evidence.",
};

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export default async function BackgroundRunPage({
  params,
}: BackgroundRunPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { runId } = await params;
  const run = await getOwnedBackgroundAgentRun({
    userId: session.user.id,
    runId,
  });
  if (!run) {
    notFound();
  }

  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  const initialData: BackgroundRunDetailData = {
    run: {
      id: run.id,
      status: run.status,
      triggerKind: run.triggerKind,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
      ref: run.ref,
      sha: run.sha,
      branch: run.branch,
      outputKind: run.outputKind,
      outputUrl: run.outputUrl,
      sandboxName: run.sandboxName,
      errorKind: run.errorKind,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
      startedAt: serializeDate(run.startedAt),
      finishedAt: serializeDate(run.finishedAt),
    },
    events: events.map((event) => ({
      id: event.id,
      eventName: event.eventName,
      status: event.status,
      summary: event.summary,
      workflowRunId: event.workflowRunId,
      sandboxName: event.sandboxName,
      errorKind: event.errorKind,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
    outputs: outputs.map((output) => ({
      id: output.id,
      kind: output.kind,
      status: output.status,
      url: output.url,
    })),
  };

  return <BackgroundRunDetail initialData={initialData} />;
}
