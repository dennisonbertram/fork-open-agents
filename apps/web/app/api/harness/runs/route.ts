import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createHarnessClient } from "@/lib/harness/client";
import { getHarnessConfig } from "@/lib/harness/config";
import { logHarnessEvent } from "@/lib/harness/logger";
import { getRequestId } from "@/lib/harness/request-id";
import {
  getLatestVerifiedBuildRunForChat,
  getVerifiedBuildEventsForRun,
  startVerifiedBuildRun,
  toVerifiedBuildEventSnapshot,
  toVerifiedBuildRunSnapshot,
} from "@/lib/harness/run-mapping";
import type { HarnessMode } from "@/lib/harness/types";
import { isProductSurfaceExposed } from "@/lib/product-surfaces/config";
import { requireOwnedHarnessSessionChat } from "../_lib/run-access";
import {
  errorToHarnessResponse,
  harnessErrorResponse,
  jsonWithRequestId,
} from "../_lib/responses";

const startRunSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1),
  latestUserMessageId: z.string().min(1),
  intentSummary: z.string().max(1000).optional(),
  selectionReason: z.string().max(500).optional(),
  mode: z.enum(["investigation", "verified_build"]).default("verified_build"),
});

function isHarnessMode(value: string): value is HarnessMode {
  return value === "investigation" || value === "verified_build";
}

export async function GET(req: Request) {
  const requestId = getRequestId(req.headers);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const chatId = url.searchParams.get("chatId");

  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!sessionId || !chatId) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "sessionId and chatId are required",
      status: 400,
      requestId,
    });
  }

  const owned = await requireOwnedHarnessSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!owned.ok) {
    return owned.response;
  }

  const run = await getLatestVerifiedBuildRunForChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!run) {
    return jsonWithRequestId({ run: null, events: [] }, 200, requestId);
  }

  const events = await getVerifiedBuildEventsForRun(run.id);
  return jsonWithRequestId(
    {
      run: toVerifiedBuildRunSnapshot(run),
      events: events.map(toVerifiedBuildEventSnapshot),
    },
    200,
    requestId,
  );
}

export async function POST(req: Request) {
  const requestId = getRequestId(req.headers);
  const startedAt = Date.now();
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isProductSurfaceExposed("verifiedBuild")) {
    return harnessErrorResponse({
      code: "product_surface_disabled",
      message: "Verified Build creation is not available",
      status: 404,
      requestId,
    });
  }

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

  const parsed = startRunSchema.safeParse(body);
  if (!parsed.success || !isHarnessMode(parsed.data.mode)) {
    return harnessErrorResponse({
      code: "invalid_request",
      message: "Invalid Verified Build run request",
      status: 400,
      requestId,
    });
  }

  const owned = await requireOwnedHarnessSessionChat({
    userId: authResult.userId,
    sessionId: parsed.data.sessionId,
    chatId: parsed.data.chatId,
  });
  if (!owned.ok) {
    return owned.response;
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

    logHarnessEvent("info", {
      event: "verified_build.run.start.requested",
      request_id: requestId,
      session_id: parsed.data.sessionId,
      chat_id: parsed.data.chatId,
      method: "POST",
      path: "/api/harness/runs",
      tenant_id: config.tenantId,
      project_id: config.defaultProjectId ?? null,
      actor_id: authResult.userId,
    });

    const run = await startVerifiedBuildRun({
      client: createHarnessClient(config),
      input: {
        ...parsed.data,
        userId: authResult.userId,
        requestId,
      },
    });

    logHarnessEvent("info", {
      event: "verified_build.run.accepted",
      request_id: requestId,
      session_id: parsed.data.sessionId,
      chat_id: parsed.data.chatId,
      verified_build_run_id: run.id,
      harness_run_id: run.harnessRunId,
      method: "POST",
      path: "/api/harness/runs",
      status: 202,
      duration_ms: Date.now() - startedAt,
      tenant_id: run.tenantId,
      project_id: run.projectId,
      actor_id: run.actorId,
      harness_status: run.status,
    });

    return jsonWithRequestId(
      { run: toVerifiedBuildRunSnapshot(run) },
      202,
      requestId,
    );
  } catch (error) {
    logHarnessEvent("error", {
      event: "verified_build.run.start.failed",
      request_id: requestId,
      session_id: parsed.data.sessionId,
      chat_id: parsed.data.chatId,
      method: "POST",
      path: "/api/harness/runs",
      duration_ms: Date.now() - startedAt,
    });
    return errorToHarnessResponse(error, requestId);
  }
}
