import {
  getOwnedBackgroundAgentRun,
  listBackgroundAgentEvents,
  listBackgroundAgentEventsAfter,
} from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 15000;

type RouteContext = {
  params: Promise<{ runId: string }>;
};

function sseEncode(
  controller: ReadableStreamDefaultController<Uint8Array>,
  data: string,
  eventName?: string,
  eventId?: string,
): void {
  const encoder = new TextEncoder();
  let payload = "";
  if (eventId !== undefined) {
    payload += `id: ${eventId}\n`;
  }
  if (eventName) {
    payload += `event: ${eventName}\n`;
  }
  payload += `data: ${data}\n\n`;
  controller.enqueue(encoder.encode(payload));
}

function sseComment(
  controller: ReadableStreamDefaultController<Uint8Array>,
  comment: string,
): void {
  controller.enqueue(new TextEncoder().encode(`: ${comment}\n\n`));
}

function parseLastEventId(req: Request): number | null {
  const header = req.headers.get("last-event-id");
  if (header === null || header === undefined) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { runId } = await context.params;
  const run = await getOwnedBackgroundAgentRun({
    userId: authResult.userId,
    runId,
  });
  if (!run) {
    return Response.json(
      { error: "Background run not found" },
      { status: 404 },
    );
  }

  const afterSequence = parseLastEventId(req);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastHeartbeat = Date.now();
      let closed = false;

      function heartbeat() {
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          sseComment(controller, "heartbeat");
          lastHeartbeat = now;
        }
      }

      function close() {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }

      // If the run is already terminal, just replay events and close
      const initialRun = await getOwnedBackgroundAgentRun({
        userId: authResult.userId,
        runId,
      });
      const isInitiallyTerminal =
        initialRun && TERMINAL_STATUSES.has(initialRun.status);

      try {
        // Phase 1: replay existing events
        let events;
        if (afterSequence !== null) {
          events = await listBackgroundAgentEventsAfter(runId, afterSequence);
        } else {
          events = await listBackgroundAgentEvents(runId);
          // listBackgroundAgentEvents returns desc order; reverse to chronological
          events.reverse();
        }

        for (const event of events) {
          if (closed) return;
          sseEncode(
            controller,
            JSON.stringify(event),
            "event",
            String(event.sequence ?? event.createdAt.getTime()),
          );
          heartbeat();
        }

        if (isInitiallyTerminal) {
          sseEncode(
            controller,
            JSON.stringify({ status: initialRun.status }),
            "done",
          );
          close();
          return;
        }

        // Phase 2: poll for new events
        let lastSentSequence =
          events.length > 0
            ? (events[events.length - 1]?.sequence ?? 0)
            : (afterSequence ?? 0);

        const interval = setInterval(async () => {
          try {
            if (closed) {
              clearInterval(interval);
              return;
            }

            // Fetch current run status and new events
            const [currentRun, newEvents] = await Promise.all([
              getOwnedBackgroundAgentRun({
                userId: authResult.userId,
                runId,
              }),
              listBackgroundAgentEventsAfter(runId, lastSentSequence),
            ]);

            for (const event of newEvents) {
              if (closed) return;
              sseEncode(
                controller,
                JSON.stringify(event),
                "event",
                String(event.sequence ?? event.createdAt.getTime()),
              );
              if (event.sequence !== null && event.sequence !== undefined) {
                lastSentSequence = event.sequence;
              }
            }

            heartbeat();

            if (currentRun && TERMINAL_STATUSES.has(currentRun.status)) {
              sseEncode(
                controller,
                JSON.stringify({ status: currentRun.status }),
                "done",
              );
              clearInterval(interval);
              close();
            }
          } catch {
            // Swallow poll errors to keep the stream alive
          }
        }, POLL_INTERVAL_MS);

        // Clean up interval on abort
        req.signal.addEventListener("abort", () => {
          clearInterval(interval);
          close();
        });
      } catch {
        close();
      }
    },
    cancel() {
      // Stream was cancelled by the client
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
