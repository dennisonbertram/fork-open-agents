"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  VerifiedBuildEventJson,
  VerifiedBuildRunJson,
} from "./use-verified-build-run";

const EVENT_NAMES = [
  "ready",
  "open_agents.run.accepted",
  "coordinator.plan",
  "workcell.created",
  "gate.running",
  "gate.completed",
  "approval.required",
  "approval.recorded",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.canceled",
];

function eventFromMessage(
  event: MessageEvent<string>,
  fallbackName: string,
  verifiedBuildRunId: string,
): VerifiedBuildEventJson {
  let payload: unknown = event.data;
  try {
    payload = JSON.parse(event.data) as unknown;
  } catch {
    payload = { raw: event.data };
  }

  return {
    id: `${verifiedBuildRunId}:${event.lastEventId || crypto.randomUUID()}`,
    verifiedBuildRunId,
    harnessEventId: event.lastEventId || crypto.randomUUID(),
    eventName: event.type === "message" ? fallbackName : event.type,
    eventPayload: payload,
    eventAt: null,
    receivedAt: new Date().toISOString(),
    requestId: null,
  };
}

export function useVerifiedBuildEvents(params: {
  run: VerifiedBuildRunJson | null | undefined;
  initialEvents: VerifiedBuildEventJson[] | undefined;
}) {
  const [events, setEvents] = useState<VerifiedBuildEventJson[]>(
    params.initialEvents ?? [],
  );

  useEffect(() => {
    setEvents(params.initialEvents ?? []);
  }, [params.initialEvents]);

  const lastEventId = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.harnessEventId) {
        return event.harnessEventId;
      }
    }
    return params.run?.lastEventId ?? null;
  }, [events, params.run?.lastEventId]);

  useEffect(() => {
    const run = params.run;
    if (!run || typeof window === "undefined") {
      return;
    }

    const search = new URLSearchParams();
    if (lastEventId) {
      search.set("after_event_id", lastEventId);
    }
    const source = new EventSource(
      `/api/harness/runs/${encodeURIComponent(run.id)}/events?${search}`,
    );

    const appendEvent = (event: MessageEvent<string>) => {
      const nextEvent = eventFromMessage(event, "message", run.id);
      setEvents((current) => {
        if (
          current.some(
            (candidate) =>
              candidate.harnessEventId === nextEvent.harnessEventId &&
              candidate.eventName === nextEvent.eventName,
          )
        ) {
          return current;
        }
        return [...current, nextEvent];
      });
    };

    source.addEventListener("message", appendEvent);
    for (const eventName of EVENT_NAMES) {
      source.addEventListener(eventName, appendEvent);
    }

    return () => {
      source.close();
    };
  }, [params.run, lastEventId]);

  return events;
}
