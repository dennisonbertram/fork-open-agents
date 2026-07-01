import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { GtmOutboundClient } from "./outbound-client";

export const metadata: Metadata = {
  title: "GTM Outbound",
  description: "Create approval-gated GTM outbound drafts.",
};

export default async function GtmOutboundPage() {
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
            <Link href="/gtm/outbound" className="font-medium text-foreground">
              GTM outbound
            </Link>
          </nav>
          <div>
            <h1 className="text-2xl font-semibold">GTM outbound</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create local outbound drafts and approval records before any email
              or CRM mutation is allowed.
            </p>
          </div>
        </div>

        <GtmOutboundClient />
      </div>
    </main>
  );
}
