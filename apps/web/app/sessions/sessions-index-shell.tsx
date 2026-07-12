"use client";

import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { buildGitHubConnectUrl } from "@/lib/github/urls";
import { useSessionsShell } from "./sessions-shell-context";

// sessions-empty-state: a brand-new user's very first authenticated screen.
// Names the "session" concept explicitly (a scoped agent conversation,
// optionally tied to a repo) instead of assuming sidebar familiarity, and
// only offers a GitHub-connect path when there is nothing to connect yet.
export function SessionsIndexShell() {
  const { activeSessionCount, openNewSessionDialog } = useSessionsShell();
  const { hasGitHubInstallations } = useSession();
  const hasActiveSessions = activeSessionCount > 0;

  return (
    <>
      <header className="border-b border-border px-3 py-2 lg:px-4 lg:py-3">
        <div className="flex min-h-8 items-center gap-2">
          <SidebarTrigger className="shrink-0" />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>
              {hasActiveSessions
                ? "Choose a session or start a new one"
                : "Start your first session"}
            </EmptyTitle>
            <EmptyDescription>
              {hasActiveSessions
                ? "Choose an existing session from the sidebar, or start a new standalone or repository session."
                : "A session is a scoped conversation with the agent — optionally tied to a repo, or standalone. Create one to get started, or connect GitHub first if you want repo-scoped sessions."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => openNewSessionDialog()}>
              <Plus className="h-4 w-4" />
              New Session
            </Button>
            {hasGitHubInstallations ? null : (
              <Button asChild variant="outline">
                <Link href={buildGitHubConnectUrl("/sessions")}>
                  Connect GitHub
                </Link>
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </div>
    </>
  );
}
