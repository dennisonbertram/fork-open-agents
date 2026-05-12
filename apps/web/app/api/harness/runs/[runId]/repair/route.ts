import { z } from "zod";
import { getRequestId } from "@/lib/harness/request-id";
import { harnessErrorResponse } from "../../../_lib/responses";
import { proxyRunAction } from "../../../_lib/proxy";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const repairSchema = z.object({
  capsuleId: z.string().min(1).optional(),
  approvalKind: z.string().min(1).optional(),
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

  const parsed = repairSchema.safeParse(body);
  if (
    !parsed.success ||
    (!parsed.data.capsuleId && !parsed.data.approvalKind)
  ) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "Repair requires a failure capsule or approval kind",
      status: 400,
      requestId,
    });
  }

  return proxyRunAction({
    runId,
    requestId,
    action: "repair",
    body: parsed.data,
  });
}
