import { getHarnessConfig } from "@/lib/harness/config";
import { createHarnessClient } from "@/lib/harness/client";
import { getRequestId } from "@/lib/harness/request-id";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  errorToHarnessResponse,
  harnessErrorResponse,
  jsonWithRequestId,
} from "../../_lib/responses";

type RouteContext = {
  params: Promise<{ workcellId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const requestId = getRequestId(req.headers);
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const config = getHarnessConfig();
    if (!config.enabled) {
      return harnessErrorResponse({
        code: "harness_disabled",
        message: "Verified Build harness is disabled",
        status: 503,
        requestId,
      });
    }

    const { workcellId } = await context.params;
    const result = await createHarnessClient(config).getWorkcell({
      context: {
        requestId,
        tenantId: config.tenantId,
        projectId: config.defaultProjectId,
        actorId: authResult.userId,
      },
      workcellId,
    });
    return jsonWithRequestId(result, 200, requestId);
  } catch (error) {
    return errorToHarnessResponse(error, requestId);
  }
}
