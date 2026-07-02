import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { GtmWeeklyReviewClient } from "./weekly-review-client";

export const metadata: Metadata = {
  title: "GTM Weekly Review",
  description: "Review completed GTM experiments and approval-gated learnings.",
};

export default async function GtmWeeklyReviewPage() {
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
            <Link
              href="/gtm/weekly-review"
              className="font-medium text-foreground"
            >
              GTM weekly review
            </Link>
          </nav>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">GTM weekly review</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Review completed experiments, source gaps, next bets, and
                approval-gated learnings.
              </p>
            </div>
          </div>
        </div>

        <GtmWeeklyReviewClient />
      </div>
    </main>
  );
}
