import { z } from "zod";
import { getRequestId } from "@/lib/harness/request-id";
import { harnessErrorResponse } from "../../../_lib/responses";
import { proxyRunAction } from "../../../_lib/proxy";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  const body =
    req.headers.get("content-length") === "0"
      ? {}
      : await req.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "Invalid cancellation request",
      status: 400,
      requestId,
    });
  }

  return proxyRunAction({
    runId,
    requestId,
    action: "cancel",
    body: parsed.data,
  });
}
