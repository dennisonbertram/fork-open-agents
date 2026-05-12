import { getRequestId } from "@/lib/harness/request-id";
import { proxyTraceExportPlan } from "../../../../_lib/proxy";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  return proxyTraceExportPlan({ runId, requestId });
}
