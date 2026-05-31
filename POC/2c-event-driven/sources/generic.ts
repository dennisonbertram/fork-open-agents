import { z } from "zod";
import type { AgentEvent, EventSource } from "../types";
import { safeEqual } from "./verify";

/**
 * Generic source — the escape hatch for any system that can POST JSON with a
 * shared bearer secret. Verification is a constant-time bearer compare (NOT an
 * HMAC), proving the abstraction supports non-HMAC schemes too.
 *
 * Header: `x-poc-source: generic` (routing) + `authorization: Bearer <secret>`.
 * Payload: a caller-supplied AgentEvent-ish object; we validate the canonical
 * shape and pass through.
 */

const genericEventSchema = z.object({
  type: z.string().min(1),
  externalId: z.string().min(1),
  subject: z.string().min(1),
  actor: z.string().optional(),
  body: z.string().optional(),
  repo: z.object({ owner: z.string(), name: z.string() }).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  occurredAt: z.string().optional(),
});

export const genericSource: EventSource = {
  id: "generic",
  matchesInbound: (inbound) => inbound.headers["x-poc-source"] === "generic",
  verify: (inbound, secret) => {
    const auth = inbound.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return { ok: false, reason: "missing bearer token" };
    }
    if (!safeEqual(auth.slice("Bearer ".length), secret)) {
      return { ok: false, reason: "bearer token mismatch" };
    }
    return { ok: true };
  },
  normalize: (parsed) => {
    const r = genericEventSchema.safeParse(parsed);
    if (!r.success) {
      return [];
    }
    const event: AgentEvent = {
      source: "generic",
      type: r.data.type,
      externalId: r.data.externalId,
      repo: r.data.repo,
      actor: r.data.actor,
      subject: r.data.subject,
      body: r.data.body,
      metadata: r.data.metadata,
      occurredAt: r.data.occurredAt,
    };
    return [event];
  },
};

export const genericSchemas = { genericEventSchema };
