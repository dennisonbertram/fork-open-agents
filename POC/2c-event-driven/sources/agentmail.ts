import { z } from "zod";
import type { AgentEvent, EventSource } from "../types";
import { safeEqual, sha256Hex } from "./verify";

/**
 * AgentMail inbound-email source.
 *
 * Signature (per AgentMail webhook docs): header `x-agentmail-signature`,
 * HMAC-SHA256 over the raw body, **bare hex** (no `sha256=` prefix) — this is
 * a deliberate difference from GitHub to prove per-source verification.
 *
 * Payload: `{ type, event_type, event_id, message: {...}, thread: {...} }`.
 * We translate `message.received` into an `email.message.received` event.
 */

const messageSchema = z.object({
  inbox_id: z.string().optional(),
  thread_id: z.string().optional(),
  message_id: z.string(),
  from: z.string(),
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string()).optional(),
  created_at: z.string().optional(),
});

const webhookSchema = z.object({
  type: z.string().optional(),
  event_type: z.string(),
  event_id: z.string(),
  message: messageSchema,
});

/** Extract a bare email address from a "Name <addr@host>" or "addr@host" form. */
function extractAddress(value: string): string {
  const angle = value.match(/<([^>]+)>/);
  return (angle ? angle[1] : value).trim().toLowerCase();
}

export const agentmailSource: EventSource = {
  id: "agentmail",
  matchesInbound: (inbound) => "x-agentmail-signature" in inbound.headers,
  verify: (inbound, secret) => {
    const provided = inbound.headers["x-agentmail-signature"];
    if (!provided) {
      return { ok: false, reason: "missing x-agentmail-signature header" };
    }
    // Bare hex, no prefix.
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
    if (r.data.event_type !== "message.received") {
      // sent/delivered/bounced/etc — recognized, not woken on by default.
      return [];
    }
    const m = r.data.message;
    const fromAddress = extractAddress(m.from);
    const toAddress = m.to?.[0] ? extractAddress(m.to[0]) : null;
    const event: AgentEvent = {
      source: "agentmail",
      type: "email.message.received",
      externalId: `agentmail:${r.data.event_id}:${m.message_id}`,
      actor: fromAddress,
      subject: m.subject ?? "(no subject)",
      body: m.text ?? (m.html ? m.html.replace(/<[^>]+>/g, " ").trim() : undefined),
      metadata: {
        inboxId: m.inbox_id ?? null,
        threadId: m.thread_id ?? null,
        messageId: m.message_id,
        from: fromAddress,
        to: toAddress,
        labels: (m.labels ?? []).join(","),
      },
      occurredAt: m.created_at,
    };
    return [event];
  },
};

export const agentmailSchemas = { webhookSchema };
