"use client";

import { VerifiedBuildEventIcon } from "@/components/verified-build/event-icon";
import { cn } from "@/lib/utils";
import type { VerifiedBuildEventJson } from "./hooks/use-verified-build-run";

function describePayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return typeof payload === "string" ? payload : null;
  }
  if ("summary" in payload && typeof payload.summary === "string") {
    return payload.summary;
  }
  if ("status" in payload && typeof payload.status === "string") {
    return payload.status;
  }
  if ("name" in payload && typeof payload.name === "string") {
    return payload.name;
  }
  return null;
}

export function VerifiedBuildTimeline({
  events,
}: {
  events: VerifiedBuildEventJson[];
}) {
  if (events.length === 0) {
    return (
      <div className="border-b border-border px-3 py-6 text-center text-xs text-muted-foreground">
        No Verified Build events yet.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {events.map((event, index) => {
        const detail = describePayload(event.eventPayload);
        return (
          <div
            key={`${event.harnessEventId}:${event.eventName}:${index}`}
            className="grid grid-cols-[18px_1fr] gap-2 px-3 py-2.5"
          >
            <div className="pt-0.5">
              <VerifiedBuildEventIcon eventName={event.eventName} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="truncate font-mono text-[11px] font-medium">
                  {event.eventName}
                </p>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {event.harnessEventId}
                </span>
              </div>
              {detail && (
                <p
                  className={cn(
                    "mt-1 line-clamp-2 text-xs text-muted-foreground",
                    detail.length > 80 && "break-words",
                  )}
                >
                  {detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
