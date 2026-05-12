import { extractSseBlocks, parseSseBlock } from "@/lib/harness/events";
import { logHarnessEvent } from "@/lib/harness/logger";
import { getRequestId } from "@/lib/harness/request-id";
import { persistVerifiedBuildEvent } from "@/lib/harness/run-mapping";
import { errorToHarnessResponse } from "../../../_lib/responses";
import { requireHarnessRunAccess } from "../../../_lib/run-access";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

function getAfterEventId(
  req: Request,
  storedLastEventId: string | null,
): string | null {
  const url = new URL(req.url);
  return (
    req.headers.get("last-event-id") ??
    url.searchParams.get("after_event_id") ??
    storedLastEventId
  );
}

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  const access = await requireHarnessRunAccess({ runId, requestId });
  if (!access.ok) {
    return access.response;
  }

  const startedAt = Date.now();
  const afterEventId = getAfterEventId(req, access.run.lastEventId);

  try {
    const harnessResponse = await access.client.openRunEvents({
      context: access.context,
      harnessRunId: access.run.harnessRunId,
      afterEventId,
      replayLimit: access.replayLimit,
      signal: req.signal,
    });

    logHarnessEvent("info", {
      event: afterEventId
        ? "verified_build.sse.replay.started"
        : "verified_build.sse.connected",
      request_id: requestId,
      verified_build_run_id: access.run.id,
      harness_run_id: access.run.harnessRunId,
      method: "GET",
      path: `/api/harness/runs/${runId}/events`,
      tenant_id: access.run.tenantId,
      project_id: access.run.projectId,
      actor_id: access.run.actorId,
    });

    const reader = harnessResponse.body?.getReader();
    if (!reader) {
      throw new Error("Harness event stream did not include a body");
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            controller.enqueue(value);
            buffer += decoder.decode(value, { stream: true });
            const extracted = extractSseBlocks(buffer);
            buffer = extracted.rest;
            for (const block of extracted.blocks) {
              const event = parseSseBlock(block);
              if (!event) {
                continue;
              }
              await persistVerifiedBuildEvent({
                verifiedBuildRunId: access.run.id,
                harnessEventId: event.id,
                eventName: event.event,
                eventPayload: event.data,
                requestId,
              });
              logHarnessEvent("info", {
                event: "verified_build.sse.event.persisted",
                request_id: requestId,
                verified_build_run_id: access.run.id,
                harness_run_id: access.run.harnessRunId,
                harness_event_id: event.id,
                harness_event_name: event.event,
              });
            }
          }

          const tail = buffer.trim();
          if (tail.length > 0) {
            const event = parseSseBlock(tail);
            if (event) {
              await persistVerifiedBuildEvent({
                verifiedBuildRunId: access.run.id,
                harnessEventId: event.id,
                eventName: event.event,
                eventPayload: event.data,
                requestId,
              });
            }
          }

          logHarnessEvent("info", {
            event: "verified_build.sse.disconnected",
            request_id: requestId,
            verified_build_run_id: access.run.id,
            harness_run_id: access.run.harnessRunId,
            duration_ms: Date.now() - startedAt,
          });
          controller.close();
        } catch (error) {
          logHarnessEvent("error", {
            event: "verified_build.sse.failed",
            request_id: requestId,
            verified_build_run_id: access.run.id,
            harness_run_id: access.run.harnessRunId,
            duration_ms: Date.now() - startedAt,
            error_message:
              error instanceof Error ? error.message : String(error),
          });
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
      cancel() {
        void reader.cancel().catch(() => undefined);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return errorToHarnessResponse(error, requestId);
  }
}
