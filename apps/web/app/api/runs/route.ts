import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { parseRunsQuery } from "@/lib/runs/query";
import { listDbBackedAutomationRuns } from "@/lib/runs/store";

function requestIdFor(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  return incoming &&
    incoming.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
}

function responseHeaders(requestId: string): HeadersInit {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

function protectedResponse(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFor(request);
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) return protectedResponse(authResult.response, requestId);

  const parsed = parseRunsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json(
      {
        requestId,
        error: { code: "invalid_query", message: parsed.error },
      },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  const result = await listDbBackedAutomationRuns({
    userId: authResult.userId,
    requestId,
    ...parsed.value,
  });
  return Response.json(result, {
    status: result.allSourcesFailed ? 503 : 200,
    headers: responseHeaders(requestId),
  });
}
