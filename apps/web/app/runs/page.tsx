import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { RunsList } from "./runs-list";

export const metadata: Metadata = {
  title: "Runs",
  description: "Monitor Automation runs across repositories.",
};

type RunsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }
  const search = params.toString();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <nav
            aria-label="Runs breadcrumb"
            className="mb-3 flex items-center gap-1.5 text-sm"
          >
            <Link
              href="/sessions"
              className="text-muted-foreground hover:text-foreground"
            >
              Workspace
            </Link>
            <ChevronRight
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-medium">Runs</span>
          </nav>
          <h1 className="text-balance text-2xl font-semibold">Runs</h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Monitor active work, investigate runs that need attention, and open
            source evidence without leaving the workspace.
          </p>
        </div>
        <RunsList key={search} searchParams={search} />
      </div>
    </main>
  );
}
