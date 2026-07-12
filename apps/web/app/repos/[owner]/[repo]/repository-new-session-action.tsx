"use client";

import { Plus } from "lucide-react";
import { useSessionsShell } from "@/app/sessions/sessions-shell-context";
import { Button } from "@/components/ui/button";

export function RepositoryNewSessionAction({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const { openNewSessionDialog } = useSessionsShell();
  return (
    <Button
      type="button"
      className="h-full min-h-16 w-full justify-start"
      onClick={() => openNewSessionDialog({ owner, repo })}
    >
      <Plus className="size-4" aria-hidden="true" />
      New Session
    </Button>
  );
}
