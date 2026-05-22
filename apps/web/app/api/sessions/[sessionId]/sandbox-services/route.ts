import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import {
  listManagedServices,
  startManagedDevServer,
} from "@/lib/sandbox/runtime/service-launch";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

async function connectManagedRuntimeSession(sessionId: string, userId: string) {
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before using managed runtime",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext;
  }

  if (sessionContext.sessionRecord.runtimeMode !== "managed_runtime") {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Managed runtime is not enabled for this session" },
        { status: 409 },
      ),
    };
  }

  if (!sessionContext.sessionRecord.sandboxState) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Resume the sandbox before using managed runtime" },
        { status: 409 },
      ),
    };
  }

  const sandbox = await connectSandbox(
    sessionContext.sessionRecord.sandboxState,
    {
      ports: DEFAULT_SANDBOX_PORTS,
    },
  );

  return {
    ok: true as const,
    sessionRecord: sessionContext.sessionRecord,
    sandbox,
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: () => true,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  if (sessionContext.sessionRecord.runtimeMode !== "managed_runtime") {
    return Response.json({ services: [] });
  }

  return Response.json({
    services: await listManagedServices({ sessionId }),
  });
}

export async function POST(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  try {
    const runtime = await connectManagedRuntimeSession(
      sessionId,
      authResult.userId,
    );
    if (!runtime.ok) {
      return runtime.response;
    }

    const service = await startManagedDevServer({
      session: runtime.sessionRecord,
      sandbox: runtime.sandbox,
    });
    if (service.status === "failed") {
      return Response.json(
        {
          error: service.failureMessage ?? "Failed to start managed service",
          service,
        },
        { status: 500 },
      );
    }
    return Response.json({ service });
  } catch (error) {
    console.error("Failed to start managed service:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start managed service",
      },
      { status: 500 },
    );
  }
}
