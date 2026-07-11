import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { parseAutomationFilters } from "@/lib/automations/filters";
import { listAutomations } from "@/lib/automations/store";
import { getRequestId } from "@/lib/harness/request-id";

function responseHeaders(requestId: string) {
  return {
    "Cache-Control": "no-store",
    "X-Request-ID": requestId,
  };
}

export async function GET(request: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) return authResult.response;

  const requestId = getRequestId(request.headers);
  const parsed = parseAutomationFilters(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json(
      {
        requestId,
        errorKind: parsed.errorKind,
        message: "Automation filters are invalid.",
      },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  const snapshot = await listAutomations({
    userId: authResult.userId,
    filters: parsed.filters,
  });
  return Response.json(
    { requestId, ...snapshot },
    { headers: responseHeaders(requestId) },
  );
}
