import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getOwnedAgentLoop } from "@/lib/agent-loops/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { createLoopTriggerBodySchema } from "@/lib/agent-loops/trigger-request-schemas";
import {
  createLoopTrigger,
  listTriggersForLoop,
} from "@/lib/background-agents/store";
import { humanizeSchedule } from "@/lib/background-agents/schedule-humanize";
import { logLoopTriggerEvent } from "./log-trigger-event";
import type {
  CreateLoopTriggerResponse,
  ListLoopTriggersResponse,
} from "./trigger-route-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ loopId: string }> };

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
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

  const { loopId } = await ctx.params;
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

  const parsed = createLoopTriggerBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        errorKind: "trigger_invalid",
        error: `Invalid trigger: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        message: `Invalid trigger: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
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

  const trigger = await createLoopTrigger({
    loopId,
    userId: authResult.userId,
    input: parsed.data,
  });

  const requestId = crypto.randomUUID();
  logLoopTriggerEvent({
    eventName: "agent-loop.trigger.created",
    loopId,
    triggerId: trigger.id,
    kind: trigger.kind,
    schedule: trigger.schedule,
    requestId,
    userId: authResult.userId,
  });

  const response: CreateLoopTriggerResponse = {
    trigger: {
      ...trigger,
      humanizedSchedule: humanizeSchedule(trigger.schedule),
    },
  };
  return Response.json(response, { status: 201 });
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
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

  const { loopId } = await ctx.params;
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

  const triggers = await listTriggersForLoop(loopId);
  const response: ListLoopTriggersResponse = {
    triggers: triggers.map((trigger) => ({
      ...trigger,
      humanizedSchedule: humanizeSchedule(trigger.schedule),
    })),
  };
  return Response.json(response);
}
