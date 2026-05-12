import { HarnessClientError } from "@/lib/harness/client";
import { HarnessConfigError } from "@/lib/harness/config";
import type {
  HarnessErrorCode,
  HarnessErrorEnvelope,
} from "@/lib/harness/types";

export function jsonWithRequestId(
  body: unknown,
  status: number,
  requestId: string,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "X-Request-ID": requestId,
    },
  });
}

export function harnessErrorResponse(params: {
  code: HarnessErrorCode;
  message: string;
  status: number;
  requestId: string;
}): Response {
  const envelope: HarnessErrorEnvelope = {
    error: {
      code: params.code,
      message: params.message,
      request_id: params.requestId,
    },
  };
  return jsonWithRequestId(envelope, params.status, params.requestId);
}

export function errorToHarnessResponse(
  error: unknown,
  requestId: string,
): Response {
  if (error instanceof HarnessClientError) {
    return harnessErrorResponse({
      code: error.code as HarnessErrorCode,
      message: "Verified Build harness request failed",
      status: error.status,
      requestId: error.requestId || requestId,
    });
  }

  if (error instanceof HarnessConfigError) {
    return harnessErrorResponse({
      code: "harness_config_invalid",
      message: "Verified Build harness configuration is invalid",
      status: 500,
      requestId,
    });
  }

  return harnessErrorResponse({
    code: "harness_internal_error",
    message: "Verified Build request failed",
    status: 500,
    requestId,
  });
}
