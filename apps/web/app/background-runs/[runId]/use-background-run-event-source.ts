"use client";

import { useEffect, useRef, useState } from "react";
import type { SerializedBackgroundEvent, StreamStatus } from "./types";

interface UseBackgroundRunEventSourceOptions {
  runId: string;
  enabled: boolean;
  onEvents: (events: SerializedBackgroundEvent[]) => void;
  onTerminal: (status: string) => void;
}

interface UseBackgroundRunEventSourceResult {
  status: StreamStatus;
}

export function useBackgroundRunEventSource(
  options: UseBackgroundRunEventSourceOptions,
): UseBackgroundRunEventSourceResult {
  const { runId, enabled, onEvents, onTerminal } = options;
  const [status, setStatus] = useState<StreamStatus>("idle");
  const onEventsRef = useRef(onEvents);
  const onTerminalRef = useRef(onTerminal);

  onEventsRef.current = onEvents;
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    setStatus("connecting");

    const url = new URL(
      `/api/background-agent-runs/${runId}/stream`,
      window.location.origin,
    );

    const es = new EventSource(url.toString());
    const accumulatedEvents: SerializedBackgroundEvent[] = [];
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    function flush() {
      if (accumulatedEvents.length > 0) {
        onEventsRef.current(accumulatedEvents.slice());
        accumulatedEvents.length = 0;
      }
    }

    es.addEventListener("event", (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as SerializedBackgroundEvent;
        accumulatedEvents.push(parsed);
      } catch {
        // Skip malformed events
      }
    });

    es.addEventListener("done", (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as { status: string };
        flush();
        onTerminalRef.current(parsed.status);
        setStatus("terminal");
        es.close();
      } catch {
        // Skip malformed done events
      }
    });

    es.addEventListener("open", () => {
      flush();
      setStatus("live");
    });

    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CONNECTING) {
        setStatus("reconnecting");
      }
    });

    flushTimer = setInterval(flush, 500);

    return () => {
      if (flushTimer !== null) clearInterval(flushTimer);
      es.close();
    };
  }, [runId, enabled]);

  return { status };
}
