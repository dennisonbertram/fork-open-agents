import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createGtmOutboundDraft } from "@/lib/gtm-outbound/store";
import {
  type GtmOutboundActionKind,
  GtmOutboundError,
} from "@/lib/gtm-outbound/types";
import type { GtmEvidenceRef } from "@/lib/gtm/types";

const OUTBOUND_ACTIONS = new Set<GtmOutboundActionKind>([
  "email_create_draft",
  "email_send",
  "crm_note_create",
  "crm_contact_update",
  "crm_sequence_enroll",
]);

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function outboundActionOrDefault(value: unknown): GtmOutboundActionKind {
  return typeof value === "string" &&
    OUTBOUND_ACTIONS.has(value as GtmOutboundActionKind)
    ? (value as GtmOutboundActionKind)
    : "email_send";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function evidenceRefs(value: unknown): GtmEvidenceRef[] {
  return Array.isArray(value) ? (value as GtmEvidenceRef[]) : [];
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      {
        error: "Invalid JSON",
        errorKind: "invalid_outbound_input",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createGtmOutboundDraft({
      userId: authResult.userId,
      requestId: requestIdFromHeaders(req),
      accountId: stringOrNull(body.accountId),
      contactId: stringOrNull(body.contactId),
      actionKind: outboundActionOrDefault(body.actionKind),
      subject: typeof body.subject === "string" ? body.subject : "",
      body: typeof body.body === "string" ? body.body : "",
      summary: stringOrNull(body.summary),
      recipientHash: stringOrNull(body.recipientHash),
      recipientDomain: stringOrNull(body.recipientDomain),
      allowedDomains: stringArray(body.allowedDomains),
      evidenceRefs: evidenceRefs(body.evidenceRefs),
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : {},
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GtmOutboundError) {
      return Response.json(
        {
          error: error.message,
          errorKind: error.kind,
        },
        {
          status: error.kind === "cross_user_reference" ? 403 : 400,
        },
      );
    }

    throw error;
  }
}
