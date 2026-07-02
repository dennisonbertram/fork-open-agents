import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  listActiveGtmLearningsForContext,
  runGtmWeeklyReview,
} from "@/lib/gtm-weekly-review/store";
import {
  type GtmWeeklyReviewApprovalInput,
  GtmWeeklyReviewError,
} from "@/lib/gtm-weekly-review/types";

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function approvalInputs(value: unknown): GtmWeeklyReviewApprovalInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is GtmWeeklyReviewApprovalInput =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { candidateKey?: unknown }).candidateKey === "string" &&
      ["approved", "denied", "merge"].includes(
        String((item as { decision?: unknown }).decision),
      ),
  );
}

export async function GET(): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const learnings = await listActiveGtmLearningsForContext(authResult.userId);
  return Response.json({ learnings });
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
      { error: "Invalid JSON", errorKind: "invalid_review_window" },
      { status: 400 },
    );
  }

  try {
    const result = await runGtmWeeklyReview({
      userId: authResult.userId,
      requestId: requestIdFromHeaders(req),
      weekStart: typeof body.weekStart === "string" ? body.weekStart : "",
      weekEnd: typeof body.weekEnd === "string" ? body.weekEnd : "",
      approvals: approvalInputs(body.approvals),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GtmWeeklyReviewError) {
      return Response.json(
        { error: error.message, errorKind: error.kind },
        { status: 400 },
      );
    }

    throw error;
  }
}
