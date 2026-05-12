"use client";

import type { VerifiedBuildEventJson } from "./hooks/use-verified-build-run";

function getWorkcellRows(events: VerifiedBuildEventJson[]) {
  return events
    .filter((event) => event.eventName.includes("workcell"))
    .map((event) => {
      const payload =
        typeof event.eventPayload === "object" && event.eventPayload !== null
          ? event.eventPayload
          : {};
      return {
        id:
          "workcell_id" in payload && typeof payload.workcell_id === "string"
            ? payload.workcell_id
            : event.harnessEventId,
        status:
          "status" in payload && typeof payload.status === "string"
            ? payload.status
            : event.eventName,
      };
    });
}

export function VerifiedBuildWorkcells({
  events,
}: {
  events: VerifiedBuildEventJson[];
}) {
  const rows = getWorkcellRows(events);

  return (
    <div className="divide-y divide-border">
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No workcells reported.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate font-mono">{row.id}</span>
            <span className="text-muted-foreground">{row.status}</span>
          </div>
        ))
      )}
    </div>
  );
}
