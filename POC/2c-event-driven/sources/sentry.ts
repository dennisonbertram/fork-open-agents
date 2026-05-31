import { z } from "zod";
import type { AgentEvent, EventSource } from "../types";
import { safeEqual, sha256Hex } from "./verify";

/**
 * Sentry issue-alert source.
 *
 * Signature (per Sentry integration-platform docs): header
 * `sentry-hook-signature`, HMAC-SHA256 over the raw body with the integration
 * client secret, hex (bare). Same algorithm as AgentMail but a different
 * header — proving the verifier must be selected per source, not per algorithm.
 * Sentry also sends `sentry-hook-resource: event_alert`.
 *
 * Payload: `{ action: "triggered", actor, data: { event, triggered_rule },
 * installation: { uuid } }`.
 */

const webhookSchema = z.object({
  action: z.string(),
  installation: z.object({ uuid: z.string() }).optional(),
  data: z.object({
    event: z.object({
      event_id: z.string(),
      title: z.string().optional(),
      web_url: z.string().optional(),
      level: z.string().optional(),
      culprit: z.string().optional(),
      project: z.union([z.number(), z.string()]).optional(),
      environment: z.string().optional(),
      release: z.string().optional(),
    }),
    triggered_rule: z.string().optional(),
  }),
});

export const sentrySource: EventSource = {
  id: "sentry",
  matchesInbound: (inbound) => "sentry-hook-signature" in inbound.headers,
  verify: (inbound, secret) => {
    const provided = inbound.headers["sentry-hook-signature"];
    if (!provided) {
      return { ok: false, reason: "missing sentry-hook-signature header" };
    }
    const expected = sha256Hex(secret, inbound.rawBody);
    if (!safeEqual(expected, provided)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return { ok: true };
  },
  normalize: (parsed) => {
    const r = webhookSchema.safeParse(parsed);
    if (!r.success) {
      return [];
    }
    const ev = r.data.data.event;
    const event: AgentEvent = {
      source: "sentry",
      type: "sentry.issue.alert",
      externalId: `sentry:${ev.event_id}`,
      actor: "sentry",
      subject: ev.title ?? "Sentry alert",
      body: ev.culprit ? `Culprit: ${ev.culprit}` : undefined,
      metadata: {
        eventId: ev.event_id,
        level: ev.level ?? null,
        webUrl: ev.web_url ?? null,
        project: ev.project ?? null,
        environment: ev.environment ?? null,
        release: ev.release ?? null,
        triggeredRule: r.data.data.triggered_rule ?? null,
        action: r.data.action,
      },
    };
    return [event];
  },
};

export const sentrySchemas = { webhookSchema };
