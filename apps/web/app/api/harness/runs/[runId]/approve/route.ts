import { z } from "zod";
import { getRequestId } from "@/lib/harness/request-id";
import { harnessErrorResponse } from "../../../_lib/responses";
import { proxyRunAction } from "../../../_lib/proxy";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const approveSchema = z.object({
  kind: z.string().min(1).max(120),
  approved: z.boolean().default(true),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "Invalid JSON body",
      status: 400,
      requestId,
    });
  }

  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "Invalid approval request",
      status: 400,
      requestId,
    });
  }

  return proxyRunAction({
    runId,
    requestId,
    action: "approve",
    approvalKind: parsed.data.kind,
    body: {
      approval_kind: parsed.data.kind,
      approved: parsed.data.approved,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    },
  });
}
