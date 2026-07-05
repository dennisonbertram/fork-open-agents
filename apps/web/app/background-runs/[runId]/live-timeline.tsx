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
  const command = stringifyPayloadValue(event.payload.command);
  const stdout = stringifyPayloadValue(event.payload.stdout);
  const stderr = stringifyPayloadValue(event.payload.stderr);
  const durationMs = stringifyPayloadValue(event.payload.durationMs);

  if (!(command || stdout || stderr || durationMs)) {
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
      {durationMs && (
        <p className="font-mono text-[10px] text-zinc-500">{durationMs}ms</p>
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
      [...events].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [events],
  );

  // Auto-scroll to the newest event, but only when the viewer is already
  // pinned to the bottom (so scrolling up to inspect history isn't interrupted).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ordered.length]);

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
          className="max-h-[32rem] space-y-2 overflow-y-auto overflow-x-hidden rounded-b-md bg-zinc-950 p-3"
        >
          {ordered.map((event) => (
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
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-zinc-500">
                <Clock3 className="h-3 w-3 shrink-0" />
                <span>{formatDate(event.createdAt)}</span>
                {event.workflowRunId && (
                  <span className="break-all">
                    workflow {event.workflowRunId}
                  </span>
                )}
                {event.requestId && (
                  <span className="break-all">request {event.requestId}</span>
                )}
                {event.sandboxName && (
                  <span className="break-all">sandbox {event.sandboxName}</span>
                )}
                <span>redaction {event.redactionStatus}</span>
                {event.errorKind && <span>{event.errorKind}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
