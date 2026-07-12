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

function withResponseHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return withResponseHeaders(authResult.response, requestId);
  }

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
