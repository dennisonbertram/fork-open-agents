import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createGtmResearchRun } from "@/lib/gtm-research/store";
import {
  type GtmResearchClaimInput,
  GtmResearchError,
} from "@/lib/gtm-research/types";
import type { GtmEvidenceRef } from "@/lib/gtm/types";

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function parseEvidenceRefs(value: unknown): GtmEvidenceRef[] {
  return Array.isArray(value)
    ? (value.filter(
        (item): item is GtmEvidenceRef =>
          Boolean(item) && typeof item === "object",
      ) as GtmEvidenceRef[])
    : [];
}

function parseClaims(value: unknown): GtmResearchClaimInput[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const claims: GtmResearchClaimInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const claim = item as Record<string, unknown>;
    if (typeof claim.text !== "string") {
      return null;
    }
    claims.push({
      text: claim.text,
      privateFact:
        typeof claim.privateFact === "boolean" ? claim.privateFact : false,
      evidenceRefs: parseEvidenceRefs(claim.evidenceRefs),
    });
  }

  return claims;
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
        errorKind: "invalid_research_input",
      },
      { status: 400 },
    );
  }

  const claims = parseClaims(body.claims);
  if (!claims) {
    return Response.json(
      {
        error: "Research claims must include string text fields.",
        errorKind: "invalid_research_input",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createGtmResearchRun({
      userId: authResult.userId,
      requestId: requestIdFromHeaders(req),
      accountId: typeof body.accountId === "string" ? body.accountId : null,
      contactId: typeof body.contactId === "string" ? body.contactId : null,
      accountName:
        typeof body.accountName === "string" ? body.accountName : null,
      contactName:
        typeof body.contactName === "string" ? body.contactName : null,
      claims,
      openQuestions: Array.isArray(body.openQuestions)
        ? body.openQuestions.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      nextSteps: Array.isArray(body.nextSteps)
        ? body.nextSteps.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GtmResearchError) {
      return Response.json(
        {
          error: error.message,
          errorKind: error.kind,
        },
        { status: error.kind === "cross_user_reference" ? 403 : 400 },
      );
    }

    throw error;
  }
}
