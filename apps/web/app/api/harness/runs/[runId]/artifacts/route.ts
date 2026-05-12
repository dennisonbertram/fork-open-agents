import { getRequestId } from "@/lib/harness/request-id";
import { proxyRunResource } from "../../../_lib/proxy";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  return proxyRunResource({ runId, requestId, resource: "artifacts" });
}
