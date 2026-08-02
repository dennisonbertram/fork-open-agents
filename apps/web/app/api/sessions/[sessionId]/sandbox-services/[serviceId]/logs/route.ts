import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { getSandboxService } from "@/lib/sandbox/runtime/service-records";
import { readServiceLogs } from "@/lib/sandbox/runtime/service-logs";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string; serviceId: string }>;
};

function getRequestedLines(req: Request): number | undefined {
  const value = new URL(req.url).searchParams.get("lines");
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, serviceId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before reading service logs",
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
        error: "Resume the sandbox before reading service logs",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  const service = await getSandboxService({ sessionId, serviceId });
  if (!service) {
    return Response.json(
      { error: "Service not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  const sandbox = await connectSandbox(
    sessionContext.sessionRecord.sandboxState,
    {
      ports: DEFAULT_SANDBOX_PORTS,
    },
  );
  const logs = await readServiceLogs({
    sandbox,
    service,
    lines: getRequestedLines(req),
  });

  return new Response(logs.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Open-Agents-Log-Lines": String(logs.lines),
      "X-Open-Agents-Log-Truncated": String(logs.truncated),
    },
  });
}
