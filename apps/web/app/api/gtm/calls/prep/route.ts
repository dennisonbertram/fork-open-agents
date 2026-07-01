import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createGtmCallPrep } from "@/lib/gtm-call/store";
import { GtmCallError } from "@/lib/gtm-call/types";
import type { GtmEvidenceRef } from "@/lib/gtm/types";

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
      { error: "Invalid JSON", errorKind: "invalid_call_input" },
      { status: 400 },
    );
  }

  try {
    const result = await createGtmCallPrep({
      userId: authResult.userId,
      requestId: requestIdFromHeaders(req),
      accountId: stringOrNull(body.accountId),
      contactId: stringOrNull(body.contactId),
      founderObjective:
        typeof body.founderObjective === "string" ? body.founderObjective : "",
      knownContext: stringArray(body.knownContext),
      openLoops: stringArray(body.openLoops),
      desiredOutcome: stringOrNull(body.desiredOutcome),
      evidenceRefs: evidenceRefs(body.evidenceRefs),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GtmCallError) {
      return Response.json(
        { error: error.message, errorKind: error.kind },
        { status: error.kind === "cross_user_reference" ? 403 : 400 },
      );
    }

    throw error;
  }
}
