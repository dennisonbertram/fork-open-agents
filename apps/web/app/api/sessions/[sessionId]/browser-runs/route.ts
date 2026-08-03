import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import {
  listManagedBrowserRuns,
  runManagedBrowserCheck,
} from "@/lib/sandbox/runtime/browser-runs";
import { getSandboxService } from "@/lib/sandbox/runtime/service-records";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type BrowserRunRequest = {
  serviceId?: string;
  targetUrl?: string;
  chatId?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    return Response.json({ runs: [] });
  }

  return Response.json({
    runs: await listManagedBrowserRuns({ sessionId }),
  });
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before running browser checks",
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
        error: "Resume the sandbox before running browser checks",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  let body: BrowserRunRequest;
  try {
    body = (await req.json()) as BrowserRunRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const serviceId = getString(body.serviceId);
  const service = serviceId
    ? await getSandboxService({ sessionId, serviceId })
    : null;
  if (serviceId && !service) {
    return Response.json(
      { error: "Service not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  const targetUrl = getString(body.targetUrl) ?? service?.url;
  if (!targetUrl) {
    return Response.json(
      { error: "Missing target URL", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const sandbox = await connectSandbox(
    sessionContext.sessionRecord.sandboxState,
    {
      ports: DEFAULT_SANDBOX_PORTS,
    },
  );
  const run = await runManagedBrowserCheck({
    sessionId,
    userId: authResult.userId,
    chatId: getString(body.chatId) ?? null,
    serviceId: service?.id ?? null,
    targetUrl,
    sandbox,
  });

  return Response.json({ run });
}
