import { createHarnessClient } from "@/lib/harness/client";
import { getHarnessConfig } from "@/lib/harness/config";
import { logHarnessEvent } from "@/lib/harness/logger";
import { getRequestId } from "@/lib/harness/request-id";
import { errorToHarnessResponse, jsonWithRequestId } from "../_lib/responses";

export async function GET(req: Request) {
  const requestId = getRequestId(req.headers);
  const startedAt = Date.now();

  try {
    const config = getHarnessConfig();
    if (!config.enabled) {
      return jsonWithRequestId({ enabled: false, requestId }, 200, requestId);
    }

    const client = createHarnessClient(config);
    const readiness = await client.checkReadiness({
      requestId,
      tenantId: config.tenantId,
      projectId: config.defaultProjectId,
      actorId: "open-agents-ready",
    });

    logHarnessEvent("info", {
      event: "verified_build.ready.checked",
      request_id: requestId,
      method: "GET",
      path: "/api/harness/ready",
      status: 200,
      duration_ms: Date.now() - startedAt,
      tenant_id: config.tenantId,
      project_id: config.defaultProjectId ?? null,
      actor_id: "open-agents-ready",
    });

    return jsonWithRequestId(readiness, 200, requestId);
  } catch (error) {
    logHarnessEvent("error", {
      event: "verified_build.ready.checked",
      request_id: requestId,
      method: "GET",
      path: "/api/harness/ready",
      status: 500,
      duration_ms: Date.now() - startedAt,
    });
    return errorToHarnessResponse(error, requestId);
  }
}
