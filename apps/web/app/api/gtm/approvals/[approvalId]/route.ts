import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { decideGtmApproval } from "@/lib/gtm-approvals/store";
import {
  type GtmApprovalDecision,
  GtmApprovalDecisionError,
} from "@/lib/gtm-approvals/types";

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function parseDecision(value: unknown): GtmApprovalDecision | null {
  return value === "approved" || value === "denied" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ approvalId: string }> },
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "Invalid JSON", errorKind: "invalid_approval_input" },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return Response.json(
      {
        error: "Approval request body must be a JSON object.",
        errorKind: "invalid_approval_input",
      },
      { status: 400 },
    );
  }

  const decision = parseDecision(body.decision);
  if (!decision) {
    return Response.json(
      {
        error: "Approval decision must be approved or denied.",
        errorKind: "invalid_approval_input",
      },
      { status: 400 },
    );
  }

  const { approvalId } = await context.params;

  try {
    const result = await decideGtmApproval({
      userId: authResult.userId,
      approvalId,
      requestId: requestIdFromHeaders(req),
      decision,
      decidedBy: authResult.userId,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof GtmApprovalDecisionError) {
      const status =
        error.kind === "approval_not_found"
          ? 404
          : error.kind === "approval_already_decided"
            ? 409
            : 400;
      return Response.json(
        { error: error.message, errorKind: error.kind },
        { status },
      );
    }

    throw error;
  }
}
