import { sandboxNotInitializedResponse } from "@/app/api/sessions/_lib/sandbox-lifecycle-response";
import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  buildHibernatedLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { getRequestId } from "@/lib/harness/request-id";
import {
  canOperateOnSandbox,
  clearSandboxResumeState,
  clearSandboxState,
  getResumableSandboxName,
  getSessionSandboxName,
  hasRuntimeSandboxState,
  isSandboxAlreadyRunningError,
  isSandboxNotFoundError,
} from "@/lib/sandbox/utils";

interface CreateSnapshotRequest {
  sessionId: string;
}

interface RestoreSnapshotRequest {
  sessionId: string;
}

export type SandboxLifecycleErrorKind =
  | "sandbox_pause_failed"
  | "sandbox_resume_failed"
  | "sandbox_resume_state_missing"
  | "sandbox_resume_unavailable";

function lifecycleResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): Response {
  return Response.json(
    { ...body, requestId },
    { status, headers: { "X-Request-ID": requestId } },
  );
}

/**
 * POST - Compatibility pause endpoint.
 * Stops the current persistent sandbox session and preserves resumability via sandboxName.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req.headers);
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: CreateSnapshotRequest;
  try {
    body = (await req.json()) as CreateSnapshotRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json(
      { error: "Missing sessionId", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: canOperateOnSandbox,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return sandboxNotInitializedResponse();
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    await sandbox.stop();

    const clearedState = clearSandboxState(sessionRecord.sandboxState);
    await updateSession(sessionId, {
      snapshotUrl: null,
      snapshotCreatedAt: null,
      sandboxState: clearedState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildHibernatedLifecycleUpdate(),
    });

    return lifecycleResponse(
      {
        snapshotId:
          getResumableSandboxName(clearedState) ??
          sessionRecord.snapshotUrl ??
          null,
        createdAt: Date.now(),
      },
      200,
      requestId,
    );
  } catch {
    const sandboxName = getResumableSandboxName(sessionRecord.sandboxState);
    console.error(
      JSON.stringify({
        event: "sandbox-lifecycle",
        message: "pause-failed",
        sessionId,
        sandboxName,
        errorKind: "sandbox_pause_failed",
        requestId,
      }),
    );
    return lifecycleResponse(
      {
        error: "Sandbox pause failed. Try again.",
        errorKind: "sandbox_pause_failed" satisfies SandboxLifecycleErrorKind,
        retryable: true,
      },
      500,
      requestId,
    );
  }
}

/**
 * PUT - Compatibility resume endpoint.
 * Resumes a named persistent sandbox, or lazily migrates a legacy snapshot-backed session.
 */
export async function PUT(req: Request) {
  const requestId = getRequestId(req.headers);
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: RestoreSnapshotRequest;
  try {
    body = (await req.json()) as RestoreSnapshotRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json(
      { error: "Missing sessionId", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxType = sessionRecord.sandboxState?.type ?? "vercel";

  if (sandboxType !== "vercel") {
    return Response.json(
      {
        error:
          "Snapshot restoration is only supported for the current cloud sandbox provider",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  if (hasRuntimeSandboxState(sessionRecord.sandboxState)) {
    const restoredFrom =
      getResumableSandboxName(sessionRecord.sandboxState) ??
      sessionRecord.snapshotUrl ??
      undefined;
    console.log(
      `[Snapshot Restore] session=${sessionId} already_running=true sandboxType=${sandboxType}`,
    );
    return lifecycleResponse(
      {
        success: true,
        alreadyRunning: true,
        restoredFrom,
        sandboxName: getResumableSandboxName(sessionRecord.sandboxState),
      },
      200,
      requestId,
    );
  }

  const persistentSandboxName = getResumableSandboxName(
    sessionRecord.sandboxState,
  );
  const legacySnapshotId = sessionRecord.snapshotUrl;

  if (!persistentSandboxName && !legacySnapshotId) {
    console.error(
      `[Snapshot Restore] session=${sessionId} error=no_resume_state sandboxType=${sandboxType}`,
    );
    return lifecycleResponse(
      {
        error: "No sandbox available for resume",
        errorKind:
          "sandbox_resume_state_missing" satisfies SandboxLifecycleErrorKind,
        retryable: false,
      },
      404,
      requestId,
    );
  }

  const restoreLegacySnapshot = () =>
    connectSandbox(
      {
        type: sandboxType,
        sandboxName: getSessionSandboxName(sessionId),
        snapshotId: legacySnapshotId ?? undefined,
      },
      {
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: DEFAULT_SANDBOX_PORTS,
        resume: true,
        createIfMissing: true,
        persistent: true,
      },
    );

  try {
    let restoredFrom = legacySnapshotId ?? persistentSandboxName;

    const sandbox = persistentSandboxName
      ? await (async () => {
          try {
            restoredFrom = persistentSandboxName;
            return await connectSandbox(
              { type: sandboxType, sandboxName: persistentSandboxName },
              {
                timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
                vcpus: DEFAULT_SANDBOX_VCPUS,
                ports: DEFAULT_SANDBOX_PORTS,
                resume: true,
              },
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            if (!legacySnapshotId || !isSandboxNotFoundError(message)) {
              throw error;
            }

            restoredFrom = legacySnapshotId;
            return restoreLegacySnapshot();
          }
        })()
      : await restoreLegacySnapshot();

    const newState = sandbox.getState?.();
    const restoredState = (newState ?? {
      type: sandboxType,
      sandboxName: persistentSandboxName ?? getSessionSandboxName(sessionId),
    }) as Parameters<typeof updateSession>[1]["sandboxState"];

    await updateSession(sessionId, {
      sandboxState: restoredState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildActiveLifecycleUpdate(restoredState),
    });

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "snapshot-restored",
    });

    const restoredSandboxName =
      getResumableSandboxName(restoredState) ?? "unknown";
    const restoredFromLabel = restoredFrom ?? "unknown";
    console.log(
      `[Snapshot Restore] session=${sessionId} success=true sandboxType=${sandboxType} sandboxName=${restoredSandboxName} restoredFrom=${restoredFromLabel}`,
    );

    return lifecycleResponse(
      {
        success: true,
        restoredFrom,
        sandboxName: restoredSandboxName,
        sandboxId: "id" in sandbox ? sandbox.id : undefined,
      },
      200,
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isSandboxAlreadyRunningError(message)) {
      const runningSandboxName =
        persistentSandboxName ?? getSessionSandboxName(sessionId);
      console.log(
        JSON.stringify({
          event: "sandbox-lifecycle",
          message: "resume-already-running",
          sessionId,
          sandboxName: runningSandboxName,
          requestId,
        }),
      );
      return lifecycleResponse(
        {
          success: true,
          alreadyRunning: true,
          restoredFrom: persistentSandboxName ?? legacySnapshotId,
          sandboxName: runningSandboxName,
        },
        200,
        requestId,
      );
    }

    if (
      persistentSandboxName &&
      !legacySnapshotId &&
      isSandboxNotFoundError(message)
    ) {
      await updateSession(sessionId, {
        sandboxState: clearSandboxResumeState(sessionRecord.sandboxState),
        ...buildHibernatedLifecycleUpdate(),
      });
      console.error(
        JSON.stringify({
          event: "sandbox-lifecycle",
          message: "resume-unavailable",
          sessionId,
          sandboxName: persistentSandboxName,
          errorKind: "sandbox_resume_unavailable",
          requestId,
        }),
      );
      return lifecycleResponse(
        {
          error: "Saved sandbox is no longer available. Create a new sandbox.",
          errorKind:
            "sandbox_resume_unavailable" satisfies SandboxLifecycleErrorKind,
          retryable: false,
        },
        404,
        requestId,
      );
    }

    console.error(
      JSON.stringify({
        event: "sandbox-lifecycle",
        message: "resume-failed",
        sessionId,
        sandboxName: persistentSandboxName,
        errorKind: "sandbox_resume_failed",
        requestId,
      }),
    );
    return lifecycleResponse(
      {
        error: "Sandbox resume failed. Try again.",
        errorKind: "sandbox_resume_failed" satisfies SandboxLifecycleErrorKind,
        retryable: true,
      },
      500,
      requestId,
    );
  }
}
