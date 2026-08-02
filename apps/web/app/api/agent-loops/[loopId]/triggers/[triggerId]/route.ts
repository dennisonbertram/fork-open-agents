import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { updateLoopTriggerBodySchema } from "@/lib/agent-loops/trigger-request-schemas";
import {
  deleteLoopTrigger,
  getOwnedLoopTrigger,
  updateLoopTrigger,
} from "@/lib/background-agents/store";
import { humanizeSchedule } from "@/lib/background-agents/schedule-humanize";
import { logLoopTriggerEvent } from "../log-trigger-event";
import type {
  DeleteLoopTriggerResponse,
  UpdateLoopTriggerResponse,
} from "../trigger-route-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ loopId: string; triggerId: string }> };

// ── Route handlers ────────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isAgentLoopsEnabled()) {
    return Response.json(
      {
        errorKind: "feature_disabled",
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  const { loopId, triggerId } = await ctx.params;
  const loop = await getOwnedAgentLoop({ userId: authResult.userId, loopId });
  if (!loop) {
    return Response.json(
      {
        errorKind: "loop_not_found",
        error: "Agent loop not found",
        message: "Agent loop not found",
      },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        errorKind: "trigger_invalid",
        error: "Invalid JSON body",
        message: "Invalid JSON body",
      },
      { status: 400 },
    );
  }

  const parsed = updateLoopTriggerBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        errorKind: "trigger_invalid",
        error: `Invalid trigger update: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        message: `Invalid trigger update: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        fields: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join("."), i.message]),
        ),
      },
      { status: 400 },
    );
  }

  // A schedule.cron trigger with no schedule can never fire — reject
  // clearing it (kind lives on the stored row, so the schema alone cannot
  // enforce this). Only costs a lookup on the rare clearing path.
  const clearsSchedule =
    "schedule" in parsed.data &&
    (parsed.data.schedule === null || parsed.data.schedule?.trim() === "");
  if (clearsSchedule) {
    const existing = await getOwnedLoopTrigger({ loopId, triggerId });
    if (existing?.kind === "schedule.cron") {
      return Response.json(
        {
          errorKind: "trigger_invalid",
          error:
            "A schedule trigger needs a schedule. Provide a new cron expression instead of clearing it, or delete the trigger.",
          message:
            "A schedule trigger needs a schedule. Provide a new cron expression instead of clearing it, or delete the trigger.",
        },
        { status: 400 },
      );
    }
  }

  const trigger = await updateLoopTrigger({
    loopId,
    triggerId,
    input: parsed.data,
  });

  if (!trigger) {
    return Response.json(
      {
        errorKind: "loop_not_found",
        error: "Trigger not found",
        message: "Trigger not found",
      },
      { status: 404 },
    );
  }

  const requestId = crypto.randomUUID();
  logLoopTriggerEvent({
    eventName: "agent-loop.trigger.updated",
    loopId,
    triggerId: trigger.id,
    kind: trigger.kind,
    schedule: trigger.schedule,
    requestId,
    userId: authResult.userId,
  });

  const response: UpdateLoopTriggerResponse = {
    trigger: {
      ...trigger,
      humanizedSchedule: humanizeSchedule(trigger.schedule),
    },
  };
  return Response.json(response);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isAgentLoopsEnabled()) {
    return Response.json(
      {
        errorKind: "feature_disabled",
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  const { loopId, triggerId } = await ctx.params;
  const loop = await getOwnedAgentLoop({ userId: authResult.userId, loopId });
  if (!loop) {
    return Response.json(
      {
        errorKind: "loop_not_found",
        error: "Agent loop not found",
        message: "Agent loop not found",
      },
      { status: 404 },
    );
  }

  // Read the trigger's kind before deleting it so the structured event below
  // is informative — deleteLoopTrigger only reports whether a row matched.
  const existingTrigger = await getOwnedLoopTrigger({ loopId, triggerId });

  const deleted = await deleteLoopTrigger({ loopId, triggerId });
  if (!deleted) {
    return Response.json(
      {
        errorKind: "loop_not_found",
        error: "Trigger not found",
        message: "Trigger not found",
      },
      { status: 404 },
    );
  }

  const requestId = crypto.randomUUID();
  logLoopTriggerEvent({
    eventName: "agent-loop.trigger.deleted",
    loopId,
    triggerId,
    kind: existingTrigger?.kind ?? "unknown",
    requestId,
    userId: authResult.userId,
  });

  const response: DeleteLoopTriggerResponse = { success: true };
  return Response.json(response);
}
