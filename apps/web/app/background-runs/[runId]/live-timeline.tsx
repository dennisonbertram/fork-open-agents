"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import {
  StatusPill,
  formatDate,
  stringifyPayloadValue,
} from "./timeline-format";
import type { SerializedBackgroundEvent } from "./types";

function CommandOutput({ event }: { event: SerializedBackgroundEvent }) {
  const command = stringifyPayloadValue(event.payload.commandLabel);
  const stdout = stringifyPayloadValue(event.payload.stdout);
  const stderr = stringifyPayloadValue(event.payload.stderr);

  // Duration is shown inline in the event footer, not here — an event whose
  // only payload is a durationMs should render no box at all (avoids an
  // orphaned "14642ms" panel with no context).
  if (!(command || stdout || stderr)) {
    return null;
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded border border-white/10 bg-black/40 p-2 text-[11px]">
      {command && (
        <p className="whitespace-pre-wrap break-all font-mono text-zinc-400">
          <span className="select-none text-zinc-600">$ </span>
          {command}
        </p>
      )}
      {stdout && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-2 font-mono text-[11px] text-zinc-300">
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-red-950/40 p-2 font-mono text-[11px] text-red-300">
          {stderr}
        </pre>
      )}
    </div>
  );
}

/**
 * Terminal-style live event log for a background run. Renders as a single
 * fixed-height, internally-scrollable column (never grows the page or overflows
 * horizontally), ordered oldest→newest so the latest event is at the bottom,
 * and auto-scrolls to the newest event while the viewer is already at the
 * bottom (does not yank the viewport if they've scrolled up to read).
 */
export function LiveTimeline({
  events,
  isLive,
  statusLabel,
}: {
  events: SerializedBackgroundEvent[];
  isLive: boolean;
  statusLabel: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const ordered = useMemo(
    () =>
      [...events].sort((a, b) => {
        // Prefer the monotonic per-run `sequence` (the stream endpoint orders
        // by it); two events can share a createdAt for fast/concurrent writes,
        // in which case sorting by timestamp alone would fall back to arbitrary
        // API order. Fall back to createdAt for legacy rows without a sequence.
        if (typeof a.sequence === "number" && typeof b.sequence === "number") {
          return a.sequence - b.sequence;
        }
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }),
    [events],
  );

  // Identify the newest event so auto-scroll follows it even when the event
  // count is capped (the non-SSE poll returns a newest-200 window, so
  // `ordered.length` can stay 200 while newer rows replace older ones).
  const newest = ordered.at(-1);
  const newestKey = newest
    ? `${newest.sequence ?? newest.createdAt}:${newest.id}`
    : null;

  // Auto-scroll to the newest event, but only when the viewer is already
  // pinned to the bottom (so scrolling up to inspect history isn't interrupted).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [newestKey]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <section className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Live timeline</h2>
        {isLive && statusLabel ? (
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No events recorded.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[32rem] min-h-[20rem] space-y-2 overflow-y-auto overflow-x-hidden rounded-b-md bg-zinc-950 p-3"
        >
          {ordered.map((event) => {
            const durationMs = stringifyPayloadValue(event.payload.durationMs);
            return (
              <div
                key={event.id}
                className="min-w-0 rounded border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-zinc-100">
                      {event.summary ?? event.eventName}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">
                      {event.eventName}
                    </p>
                  </div>
                  <StatusPill status={event.status} />
                </div>
                <CommandOutput event={event} />
                {/* Only what VARIES per event: time, duration, and anomalies.
                    Run-level metadata (workflow run, request id, sandbox) lives
                    once in the Run/Debug sidebar; redaction is surfaced only
                    when it is NOT "passed". */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-zinc-500">
                  <Clock3 className="h-3 w-3 shrink-0" />
                  <span>{formatDate(event.createdAt)}</span>
                  {durationMs && (
                    <span className="text-zinc-600">· {durationMs}ms</span>
                  )}
                  {event.redactionStatus !== "passed" && (
                    <span className="text-amber-400">
                      redaction {event.redactionStatus}
                    </span>
                  )}
                  {event.errorKind && (
                    <span className="text-red-400">{event.errorKind}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
