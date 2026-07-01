import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  listGtmActivationSignals,
  runGtmActivationWatcher,
} from "@/lib/gtm-activation/store";
import { GtmActivationError } from "@/lib/gtm-activation/types";
import type { GtmActivationSourceInput } from "@/lib/gtm-activation/types";

function requestIdFromHeaders(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function sourceInputs(value: unknown): GtmActivationSourceInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is GtmActivationSourceInput =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { targetUserHash?: unknown }).targetUserHash === "string",
  );
}

export async function GET(): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const signals = await listGtmActivationSignals(authResult.userId);
  return Response.json({ signals });
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "Invalid JSON", errorKind: "invalid_signal_input" },
      { status: 400 },
    );
  }

  try {
    const result = await runGtmActivationWatcher({
      userId: authResult.userId,
      requestId: requestIdFromHeaders(req),
      candidates: sourceInputs(body.candidates),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GtmActivationError) {
      return Response.json(
        { error: error.message, errorKind: error.kind },
        { status: 400 },
      );
    }

    throw error;
  }
}
