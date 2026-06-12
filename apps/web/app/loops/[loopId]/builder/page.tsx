/**
 * Builder page — /loops/[loopId]/builder
 *
 * Server component: authenticates, loads the loop, and renders the
 * client BuilderCanvas with the current definition.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import { BuilderCanvas } from "./builder-canvas";
import type { LoopDefinition } from "@/lib/agent-loops/types";

type BuilderPageProps = {
  params: Promise<{ loopId: string }>;
};

export const metadata: Metadata = {
  title: "Loop builder",
  description: "Visual loop definition builder.",
};

export default async function BuilderPage({ params }: BuilderPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { loopId } = await params;
  const loop = await getOwnedAgentLoop({ userId: session.user.id, loopId });
  if (!loop) {
    notFound();
  }

  // Treat null definition as empty
  const definition: LoopDefinition =
    (loop.definition as LoopDefinition | null) ?? {
      nodes: [],
      edges: [],
    };

  return (
    <BuilderCanvas
      loopId={loopId}
      loopName={loop.name}
      definition={definition}
    />
  );
}
