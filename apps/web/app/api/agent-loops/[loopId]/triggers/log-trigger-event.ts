/**
 * Structured console logging for loop-trigger CRUD (#762).
 *
 * agent_loop_events requires a loopRunId FK (see lib/db/schema.ts) so trigger
 * CRUD events — which happen outside of any run — cannot be recorded there.
 * Instead this follows the same structured `console.<level>(namespace, {...})`
 * pattern already used for trigger-adjacent events with no run context (see
 * lib/background-agents/dispatcher.ts's `run budget exhausted` console.warn).
 *
 * Emits agent-loop.trigger.created|updated|deleted at info level with
 * { loopId, triggerId, kind, schedule?, requestId, userId }. Never logs
 * webhookSecretHash or other secret fields.
 */

export type LoopTriggerEventName =
  | "agent-loop.trigger.created"
  | "agent-loop.trigger.updated"
  | "agent-loop.trigger.deleted";

export function logLoopTriggerEvent(params: {
  eventName: LoopTriggerEventName;
  loopId: string;
  triggerId: string;
  kind: string;
  schedule?: string | null;
  requestId: string;
  userId: string;
}): void {
  console.info(`[agent-loops] ${params.eventName}`, {
    eventName: params.eventName,
    loopId: params.loopId,
    triggerId: params.triggerId,
    kind: params.kind,
    ...(params.schedule !== undefined ? { schedule: params.schedule } : {}),
    requestId: params.requestId,
    userId: params.userId,
  });
}
