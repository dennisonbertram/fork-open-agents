"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type RepoAgentsDashboardProps = {
  owner: string;
  repo: string;
};

/**
 * Roster entry point for the repo agents page.
 * The "New agent" button navigates to the full-page /agents/new builder.
 */
export function RepoAgentsDashboard({ owner, repo }: RepoAgentsDashboardProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild>
        <Link href={`/repos/${owner}/${repo}/agents/new`}>
          <Plus className="h-4 w-4" />
          New agent
        </Link>
      </Button>
    </div>
  );
}
