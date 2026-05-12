import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import { createHarnessClient } from "@/lib/harness/client";
import { getHarnessConfig } from "@/lib/harness/config";
import {
  getVerifiedBuildEventsForRun,
  getVerifiedBuildRunByIdForUser,
  toVerifiedBuildEventSnapshot,
  toVerifiedBuildRunSnapshot,
} from "@/lib/harness/run-mapping";
import type { HarnessRequestContext } from "@/lib/harness/types";
import {
  errorToHarnessResponse,
  harnessErrorResponse,
  jsonWithRequestId,
} from "./responses";

type RunAccessResult =
  | {
      ok: true;
      userId: string;
      run: NonNullable<
        Awaited<ReturnType<typeof getVerifiedBuildRunByIdForUser>>
      >;
      context: HarnessRequestContext;
      client: ReturnType<typeof createHarnessClient>;
      replayLimit: number;
    }
  | {
      ok: false;
      response: Response;
    };

export async function requireHarnessRunAccess(params: {
  runId: string;
  requestId: string;
}): Promise<RunAccessResult> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const run = await getVerifiedBuildRunByIdForUser({
    runId: params.runId,
    userId: authResult.userId,
  });
  if (!run) {
    return {
      ok: false,
      response: harnessErrorResponse({
        code: "not_found",
        message: "Verified Build run not found",
        status: 404,
        requestId: params.requestId,
      }),
    };
  }

  const config = getHarnessConfig();
  if (!config.enabled) {
    return {
      ok: false,
      response: harnessErrorResponse({
        code: "harness_disabled",
        message: "Verified Build harness is disabled",
        status: 503,
        requestId: params.requestId,
      }),
    };
  }

  return {
    ok: true,
    userId: authResult.userId,
    run,
    context: {
      tenantId: run.tenantId,
      projectId: run.projectId,
      actorId: run.actorId,
      requestId: params.requestId,
    },
    client: createHarnessClient(config),
    replayLimit: config.sseReplayLimit,
  };
}

export async function getRunSnapshotResponse(params: {
  runId: string;
  requestId: string;
}): Promise<Response> {
  const access = await requireHarnessRunAccess(params);
  if (!access.ok) {
    return access.response;
  }

  try {
    const harnessRun = await access.client.getRun({
      context: access.context,
      harnessRunId: access.run.harnessRunId,
    });
    const events = await getVerifiedBuildEventsForRun(access.run.id);
    return jsonWithRequestId(
      {
        run: toVerifiedBuildRunSnapshot(access.run),
        harnessRun,
        events: events.map(toVerifiedBuildEventSnapshot),
      },
      200,
      params.requestId,
    );
  } catch (error) {
    return errorToHarnessResponse(error, params.requestId);
  }
}

export async function requireOwnedHarnessSessionChat(params: {
  userId: string;
  sessionId: string;
  chatId: string;
}) {
  return requireOwnedSessionChat({
    userId: params.userId,
    sessionId: params.sessionId,
    chatId: params.chatId,
    forbiddenMessage: "Forbidden",
  });
}
