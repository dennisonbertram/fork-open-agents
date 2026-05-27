"use client";

import { Loader2, Terminal } from "lucide-react";
import type { WebAgentWorkspaceStatusData } from "@/app/types";
import { cn } from "@/lib/utils";

export function WorkspaceStartupStatus({
  status,
}: {
  status: WebAgentWorkspaceStatusData | null;
}) {
  const logLines = status?.logLines ?? [];

  return (
    <div
      aria-live="polite"
      className="my-1.5 max-w-full border border-transparent py-0.5"
    >
      <div className="inline-flex max-w-full flex-col gap-2">
        <div className="inline-flex min-w-0 items-center gap-2 rounded-md py-px text-sm text-muted-foreground">
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
          <span className="min-w-0 truncate leading-none">
            {status?.message ?? "Thinking…"}
          </span>
        </div>

        {logLines.length > 0 ? (
          <div className="w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-md border border-border/70 bg-zinc-950 text-zinc-200 shadow-sm dark:bg-zinc-950">
            <div className="flex min-w-0 items-center gap-2 border-zinc-800 border-b px-3 py-2 text-zinc-400">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-xs">
                {status?.title ?? "Startup logs"}
              </span>
            </div>
            <pre
              className={cn(
                "max-h-52 overflow-auto px-3 py-2 font-mono text-[11px] leading-5",
                "whitespace-pre-wrap break-words [scrollbar-width:thin]",
              )}
            >
              {logLines.join("\n")}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
