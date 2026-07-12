import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BuilderCanvas } from "@/app/loops/[loopId]/builder/builder-canvas";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import type { LoopDefinition, LoopGuardrails } from "@/lib/agent-loops/types";
import { getServerSession } from "@/lib/session/get-server-session";

type EditLoopAutomationPageProps = {
  params: Promise<{ loopId: string }>;
};

export const metadata: Metadata = {
  title: "Edit multi-step Automation",
  description: "Edit an advanced durable coding Automation.",
};

export default async function EditLoopAutomationPage({
  params,
}: EditLoopAutomationPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { loopId } = await params;
  const loop = await getOwnedAgentLoop({ userId: session.user.id, loopId });
  if (!loop) notFound();

  const definition: LoopDefinition =
    (loop.definition as LoopDefinition | null) ?? { nodes: [], edges: [] };

  return (
    <BuilderCanvas
      loopId={loopId}
      loopName={loop.name}
      loopDescription={loop.description}
      loopStatus={loop.status}
      loopGuardrails={loop.guardrails as LoopGuardrails | undefined}
      watchdogEnabled={loop.watchdogEnabled ?? false}
      watchdogInstructions={loop.watchdogInstructions}
      watchdogRetryBudget={loop.watchdogRetryBudget ?? 2}
      definition={definition}
      surface="automation"
    />
  );
}
