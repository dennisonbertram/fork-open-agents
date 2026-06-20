import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { LoopsList } from "./loops-list";

export const metadata: Metadata = {
  title: "Loops",
  description: "Manage and monitor Agent Loops.",
};

export default async function LoopsPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const enabled = isAgentLoopsEnabled();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <nav
              aria-label="Loop breadcrumb"
              className="mb-3 flex items-center gap-1.5 text-sm"
            >
              <Link
                href="/sessions"
                className="text-muted-foreground hover:text-foreground"
              >
                Workspace
              </Link>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Link href="/loops" className="font-medium text-foreground">
                Loops
              </Link>
            </nav>
            <h1 className="text-2xl font-semibold">Loops</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-step agent loops across your repositories.
            </p>
          </div>
          {enabled && (
            <Link
              href="/loops/new"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/20"
            >
              <Plus className="h-4 w-4" />
              New loop
            </Link>
          )}
        </div>
        <LoopsList createEnabled={enabled} />
      </div>
    </main>
  );
}
