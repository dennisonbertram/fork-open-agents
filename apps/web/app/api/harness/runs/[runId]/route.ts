import { getRequestId } from "@/lib/harness/request-id";
import { getRunSnapshotResponse } from "../../_lib/run-access";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { runId } = await context.params;
  return getRunSnapshotResponse({ runId, requestId });
}
