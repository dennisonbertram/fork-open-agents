"use client";

import type { VerifiedBuildRunJson } from "./hooks/use-verified-build-run";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono">{value ?? "-"}</span>
    </div>
  );
}

export function VerifiedBuildObservability({
  run,
}: {
  run: VerifiedBuildRunJson;
}) {
  return (
    <div className="divide-y divide-border border-t border-border">
      <Row label="Run" value={run.harnessRunId} />
      <Row label="Request" value={run.lastEventId} />
      <Row label="Event" value={run.lastEventName} />
      <Row label="Tenant" value={run.tenantId} />
      <Row label="Project" value={run.projectId} />
      <Row label="Actor" value={run.actorId} />
    </div>
  );
}
