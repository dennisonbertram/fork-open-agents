import { getRequestId } from "@/lib/harness/request-id";
import { harnessErrorResponse } from "../../_lib/responses";
import { proxyArtifact } from "../../_lib/proxy";

type RouteContext = {
  params: Promise<{ artifactId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const { artifactId } = await context.params;
  const runId = new URL(req.url).searchParams.get("runId");

  if (!runId) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "runId is required to scope artifact access",
      status: 400,
      requestId,
    });
  }

  return proxyArtifact({ runId, artifactId, requestId });
}
