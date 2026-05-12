"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VerifiedBuildStatusBadge } from "@/components/verified-build/status-badge";
import { cn } from "@/lib/utils";
import { useVerifiedBuildEvents } from "./hooks/use-verified-build-events";
import { useVerifiedBuildRun } from "./hooks/use-verified-build-run";
import { VerifiedBuildApprovals } from "./verified-build-approvals";
import { VerifiedBuildEvidence } from "./verified-build-evidence";
import { VerifiedBuildObservability } from "./verified-build-observability";
import { VerifiedBuildTimeline } from "./verified-build-timeline";
import { VerifiedBuildWorkcells } from "./verified-build-workcells";

type VerifiedBuildPanelTab = "timeline" | "workcells" | "evidence" | "ops";

const tabs: Array<{ id: VerifiedBuildPanelTab; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "workcells", label: "Workcells" },
  { id: "evidence", label: "Evidence" },
  { id: "ops", label: "Ops" },
];

export function VerifiedBuildPanel({
  sessionId,
  chatId,
}: {
  sessionId: string;
  chatId: string;
}) {
  const [activeTab, setActiveTab] = useState<VerifiedBuildPanelTab>("timeline");
  const { data, error, isLoading, mutate } = useVerifiedBuildRun({
    sessionId,
    chatId,
  });
  const run = data?.run ?? null;
  const events = useVerifiedBuildEvents({
    run,
    initialEvents: data?.events,
  });

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-blue-500" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Verified Build</p>
            {run && (
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {run.harnessRunId}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {run && <VerifiedBuildStatusBadge status={run.status} />}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void mutate()}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-[7px]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!run ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          {error
            ? "Verified Build status unavailable."
            : "No Verified Build run for this chat."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === "timeline" && (
              <VerifiedBuildTimeline events={events} />
            )}
            {activeTab === "workcells" && (
              <VerifiedBuildWorkcells events={events} />
            )}
            {activeTab === "evidence" && (
              <VerifiedBuildEvidence run={run} events={events} />
            )}
            {activeTab === "ops" && (
              <>
                <VerifiedBuildApprovals run={run} />
                <VerifiedBuildObservability run={run} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default VerifiedBuildPanel;
