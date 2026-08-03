import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { stopManagedService } from "@/lib/sandbox/runtime/service-launch";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string; serviceId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, serviceId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before stopping managed runtime",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }
  if (sessionContext.sessionRecord.runtimeMode !== "managed_runtime") {
    return Response.json(
      {
        error: "Managed runtime is not enabled for this session",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }
  if (!sessionContext.sessionRecord.sandboxState) {
    return Response.json(
      {
        error: "Resume the sandbox before stopping managed runtime",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  const sandbox = await connectSandbox(
    sessionContext.sessionRecord.sandboxState,
    {
      ports: DEFAULT_SANDBOX_PORTS,
    },
  );
  const service = await stopManagedService({ sessionId, serviceId, sandbox });
  if (!service) {
    return Response.json(
      { error: "Service not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ service });
}
