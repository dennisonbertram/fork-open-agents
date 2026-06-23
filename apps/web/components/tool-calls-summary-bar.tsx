"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type StatusWordPair = {
  present: string;
  past: string;
};

const STATUS_WORD_PAIRS: StatusWordPair[] = [
  { present: "Pondering", past: "Pondered" },
  { present: "Crafting", past: "Crafted" },
  { present: "Vibing", past: "Vibed" },
  { present: "Simmering", past: "Simmered" },
  { present: "Marinating", past: "Marinated" },
  { present: "Philosophising", past: "Philosophised" },
  { present: "Ruminating", past: "Ruminated" },
];

function hashString(value: string): number {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function getStatusWordPair(seed: string | null): StatusWordPair {
  if (!seed) {
    return STATUS_WORD_PAIRS[0];
  }

  return STATUS_WORD_PAIRS[hashString(seed) % STATUS_WORD_PAIRS.length];
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

function renderSegments(segments: string[]) {
  return segments.map((segment, i) => (
    <span key={i}>
      <span className="text-muted-foreground/40"> · </span>
      {segment}
    </span>
  ));
}

function formatTokensPerSecond(value: number): string {
  if (value >= 100) {
    return `${Math.round(value).toLocaleString("en-US")} tok/s`;
  }

  if (value >= 10) {
    return `${value.toLocaleString("en-US", {
      maximumFractionDigits: 1,
    })} tok/s`;
  }

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })} tok/s`;
}

function formatUsd(amount: number): string {
  if (amount >= 1) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  if (amount >= 0.01) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  );
}

export type ToolCallsSummaryResponseStats = {
  tokensPerSecond: number | null;
  costUsd: number | null;
  costSource: "gateway" | "estimate" | null;
};

export function formatToolCallsSummaryResponseStats(
  responseStats: ToolCallsSummaryResponseStats | null | undefined,
): string[] {
  const hoverSegments: string[] = [];

  if (responseStats?.tokensPerSecond != null) {
    hoverSegments.push(formatTokensPerSecond(responseStats.tokensPerSecond));
  }

  if (responseStats?.costUsd != null) {
    const costLabel =
      responseStats.costSource === "estimate" ? "est. cost" : "cost";
    hoverSegments.push(`${costLabel} ${formatUsd(responseStats.costUsd)}`);
  }

  return hoverSegments;
}

export function ToolCallsSummaryBar({
  isExpanded,
  onToggle,
  isStreaming,
  toolCallCount,
  changedFiles,
  activityLabel,
  durationMs,
  startedAt,
  statusWordSeed,
  responseStats,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming: boolean;
  toolCallCount: number;
  /** Unique file paths modified by write/edit tool calls in this turn. */
  changedFiles: string[];
  /** Current live work item to surface while tool details are collapsed. */
  activityLabel?: string | null;
  /** Final generation duration in ms (for completed messages). */
  durationMs: number | null;
  /** ISO timestamp of when generation started — i.e. the preceding user
   *  message's createdAt — used for a live counter while streaming. */
  startedAt: string | null;
  /** Stable per-message seed used to choose a status word pair. */
  statusWordSeed: string | null;
  /** Response usage metrics shown when hovering the collapsed summary. */
  responseStats?: ToolCallsSummaryResponseStats | null;
}) {
  // ---------------------------------------------------------------------------
  // Elapsed time logic
  //
  // Completed messages  → use the pre-computed durationMs (accurate, static).
  // Streaming messages  → tick a live counter from startedAt (the moment the
  //                        user sent their message).
  // ---------------------------------------------------------------------------
  const startMs = startedAt ? new Date(startedAt).getTime() : null;

  const computeLiveElapsed = () =>
    startMs != null
      ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      : 0;

  const [liveElapsed, setLiveElapsed] = useState(computeLiveElapsed);

  useEffect(() => {
    if (!isStreaming) return;

    setLiveElapsed(computeLiveElapsed());
    const interval = setInterval(() => {
      setLiveElapsed(computeLiveElapsed());
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable per startMs
  }, [isStreaming, startMs]);

  // Pick the right elapsed value.
  // When streaming ends for messages created during this session, durationMs
  // will be null (it's only computed server-side for initial DB messages).
  // Fall back to liveElapsed so the timer freezes at the last ticked value
  // instead of dropping to 0.
  const elapsedSeconds = isStreaming
    ? liveElapsed
    : durationMs != null
      ? Math.max(0, Math.round(durationMs / 1000))
      : liveElapsed;

  const statusWordPair = getStatusWordPair(statusWordSeed);
  const statusLabel = isStreaming
    ? `${statusWordPair.present}…`
    : statusWordPair.past;
  const toolCallLabel =
    toolCallCount > 0
      ? `${toolCallCount} tool call${toolCallCount !== 1 ? "s" : ""}`
      : null;

  const desktopSegments: string[] = [];
  const mobileSegments: string[] = [];

  if (elapsedSeconds > 0) {
    const elapsedLabel = formatElapsedTime(elapsedSeconds);
    desktopSegments.push(elapsedLabel);
    mobileSegments.push(elapsedLabel);
  }

  if (activityLabel) {
    desktopSegments.push(activityLabel);
    mobileSegments.push(activityLabel);
  }

  if (toolCallLabel) {
    desktopSegments.push(toolCallLabel);
  }

  if (changedFiles.length > 0) {
    const filesLabel = `${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} changed`;
    desktopSegments.push(filesLabel);
  }

  if (toolCallLabel) {
    mobileSegments.push(toolCallLabel);
  }

  const responseStatSegments =
    formatToolCallsSummaryResponseStats(responseStats);
  const fullSummary = [
    statusLabel,
    ...desktopSegments,
    ...responseStatSegments,
  ].join(" · ");

  return (
    <div className="my-1.5 border border-transparent py-0.5">
      <div className="group/timing flex max-w-full items-center gap-1 sm:inline-flex">
        <button
          type="button"
          onClick={onToggle}
          aria-label={fullSummary}
          title={fullSummary}
          className={cn(
            "group flex min-w-0 max-w-full items-center gap-2 rounded-md py-px text-left text-sm text-muted-foreground tabular-nums transition-colors hover:text-foreground sm:inline-flex sm:w-auto",
            isStreaming && "text-foreground/90",
          )}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                isStreaming
                  ? "animate-pulse bg-muted-foreground"
                  : "bg-muted-foreground/50",
              )}
            />
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 overflow-hidden whitespace-nowrap leading-none sm:flex-none sm:overflow-visible sm:whitespace-normal",
              isStreaming && "animate-pulse motion-reduce:animate-none",
            )}
          >
            {statusLabel}
            {mobileSegments.length > 0 && (
              <span className="inline-block max-w-full truncate align-bottom sm:hidden">
                {renderSegments(mobileSegments)}
              </span>
            )}
            {desktopSegments.length > 0 && (
              <span className="hidden sm:inline">
                {renderSegments(desktopSegments)}
              </span>
            )}
            {responseStatSegments.length > 0 && (
              <span className="hidden opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">
                {renderSegments(responseStatSegments)}
              </span>
            )}
          </span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 ease-out motion-reduce:transition-none",
              isExpanded && "rotate-90",
            )}
          />
        </button>
      </div>
    </div>
  );
}
