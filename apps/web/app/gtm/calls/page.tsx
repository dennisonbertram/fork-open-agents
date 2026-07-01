import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { GtmCallsClient } from "./calls-client";

export const metadata: Metadata = {
  title: "GTM Calls",
  description: "Prepare and debrief founder GTM calls.",
};

export default async function GtmCallsPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="min-w-0">
          <nav
            aria-label="GTM breadcrumb"
            className="mb-3 flex items-center gap-1.5 text-sm"
          >
            <Link
              href="/sessions"
              className="text-muted-foreground hover:text-foreground"
            >
              Workspace
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <Link href="/gtm/calls" className="font-medium text-foreground">
              GTM calls
            </Link>
          </nav>
          <div>
            <h1 className="text-2xl font-semibold">GTM calls</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Prepare founder calls, debrief notes, and keep follow-up actions
              pending approval.
            </p>
          </div>
        </div>

        <GtmCallsClient />
      </div>
    </main>
  );
}
