import { dispatchScheduledBackgroundAgents } from "@/lib/background-agents/dispatcher";
import { getBackgroundAgentsCronSecret } from "@/lib/background-agents/config";
import { runEventRetention } from "@/lib/db/retention";

function isAuthorized(req: Request, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (authorization === `Bearer ${secret}`) {
    return true;
  }

  return req.headers.get("x-background-agents-cron-secret") === secret;
}

async function handleCron(req: Request) {
  const secret = getBackgroundAgentsCronSecret();
  if (!secret) {
    return Response.json(
      {
        error: "CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured",
        errorKind: "internal_error",
      },
      { status: 500 },
    );
  }

  if (!isAuthorized(req, secret)) {
    return Response.json(
      { error: "Unauthorized", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const requestId = req.headers.get("x-request-id");
  const result = await dispatchScheduledBackgroundAgents({
    requestId,
  });

  await runEventRetention({
    runId: requestId ?? crypto.randomUUID(),
  });

  return Response.json(result);
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
