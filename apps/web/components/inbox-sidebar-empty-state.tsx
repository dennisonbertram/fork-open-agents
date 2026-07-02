"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type InboxSidebarEmptyStateProps = {
  showArchived: boolean;
  archivedSessionsError: string | null;
  onOpenNewSession: () => void;
  onRetryArchivedSessions: () => void;
};

// sidebar-empty-state: renders when `groupedSessions.length === 0`. The
// zero-sessions branch gets a CTA (not plain text only) so it agrees with
// the main-pane empty state in `sessions-index-shell.tsx`. The
// archived-error Retry branch is preserved byte-for-byte.
export function InboxSidebarEmptyState({
  showArchived,
  archivedSessionsError,
  onOpenNewSession,
  onRetryArchivedSessions,
}: InboxSidebarEmptyStateProps) {
  if (showArchived) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground">
        {archivedSessionsError ?? "No archived sessions"}
        {archivedSessionsError ? (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryArchivedSessions}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      No sessions yet
      <div className="mt-3">
        <Button type="button" size="sm" onClick={onOpenNewSession}>
          <Plus className="h-3.5 w-3.5" />
          New Session
        </Button>
      </div>
    </div>
  );
}
