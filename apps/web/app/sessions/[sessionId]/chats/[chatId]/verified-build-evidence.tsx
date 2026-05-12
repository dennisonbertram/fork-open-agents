"use client";

import { GitPullRequest, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  VerifiedBuildEventJson,
  VerifiedBuildRunJson,
} from "./hooks/use-verified-build-run";

function getEvidenceEvents(events: VerifiedBuildEventJson[]) {
  return events.filter(
    (event) =>
      event.eventName.includes("gate") ||
      event.eventName.includes("artifact") ||
      event.eventName.includes("capsule") ||
      event.eventName.includes("report"),
  );
}

export function VerifiedBuildEvidence({
  run,
  events,
}: {
  run: VerifiedBuildRunJson | null;
  events: VerifiedBuildEventJson[];
}) {
  const evidenceEvents = getEvidenceEvents(events);
  const canCreatePr = run?.goNoGo === "go" && run.status === "completed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <Button
          size="sm"
          className="h-7 w-full justify-center gap-1.5 text-xs"
          disabled={!canCreatePr}
        >
          {canCreatePr ? (
            <GitPullRequest className="h-3.5 w-3.5" />
          ) : (
            <LockKeyhole className="h-3.5 w-3.5" />
          )}
          PR gated by evidence
        </Button>
      </div>
      <div className="divide-y divide-border">
        {evidenceEvents.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No evidence reported.
          </p>
        ) : (
          evidenceEvents.map((event) => (
            <div
              key={`${event.harnessEventId}:${event.eventName}`}
              className="px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono">
                  {event.eventName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {event.harnessEventId}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
