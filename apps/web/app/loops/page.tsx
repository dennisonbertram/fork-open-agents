import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Loops</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-step agent workflows that iterate over your repositories.
            </p>
          </div>
          <Link
            href="/loops/new"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/20"
          >
            <Plus className="h-4 w-4" />
            New loop
          </Link>
        </div>
        <LoopsList />
      </div>
    </main>
  );
}
