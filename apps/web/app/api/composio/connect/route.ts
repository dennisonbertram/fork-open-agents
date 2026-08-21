import { z } from "zod";
import { getComposioClient } from "@/lib/composio/client";
import {
  type ManagedAuthConfigClient,
  resolveManagedAuthConfigId,
} from "@/lib/composio/managed-auth-config";
import { toComposioUserId } from "@/lib/composio/user-id";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

/**
 * Accept either toolkitSlug (preferred — one-click managed OAuth) or
 * authConfigId (advanced escape hatch for custom OAuth apps). At least one of
 * the two must be present.
 */
const connectRequestSchema = z
  .object({
    toolkitSlug: z.string().trim().min(1).optional(),
    authConfigId: z.string().trim().min(1).optional(),
    alias: z.string().trim().min(1).max(80).optional(),
    callbackUrl: z.url().optional(),
  })
  .refine((data) => Boolean(data.toolkitSlug) || Boolean(data.authConfigId), {
    message: "Either toolkitSlug or authConfigId must be provided",
  });

export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = connectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid Composio connect payload",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  if (
    parsed.data.callbackUrl &&
    !isAllowedCallbackOrigin(parsed.data.callbackUrl, req)
  ) {
    return Response.json(
      { error: "callbackUrl is not allowed", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const client = getComposioClient();
    const composioUserId = toComposioUserId(authResult.userId);

    // For a toolkit slug, resolve (or create) a Composio-managed auth config and
    // use connectedAccounts.link — the toolkit authorize/initiate path was
    // deprecated by Composio for managed OAuth and now returns 400.
    const authConfigId = parsed.data.toolkitSlug
      ? await resolveManagedAuthConfigId(
          client as unknown as ManagedAuthConfigClient,
          parsed.data.toolkitSlug,
        )
      : (parsed.data.authConfigId as string);

    const connectionRequest = await client.connectedAccounts.link(
      composioUserId,
      authConfigId,
      {
        ...(parsed.data.alias ? { alias: parsed.data.alias } : {}),
        ...(parsed.data.callbackUrl
          ? { callbackUrl: parsed.data.callbackUrl }
          : {}),
      },
    );

    return Response.json({
      id: connectionRequest.id,
      redirectUrl: connectionRequest.redirectUrl,
    });
  } catch (error) {
    // Never echo error.message to the client — Composio SDK errors can carry
    // internal hostnames/infra details. Log the raw message server-side only.
    console.warn(
      JSON.stringify({
        service: "composio-connect",
        event: "composio.connect.failed",
        errorKind: "composio_connect_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      {
        error: "Failed to create Composio connection link",
        errorKind: "composio_connect_failed",
      },
      { status: 400 },
    );
  }
}

/**
 * Restricts callbackUrl to this app's own origins so the connect endpoint
 * cannot be used as an open redirect: the request's own origin, plus known
 * deployment origins derived from env (BETTER_AUTH_URL / VERCEL_URL /
 * NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL).
 */
function isAllowedCallbackOrigin(callbackUrl: string, req: Request): boolean {
  let callbackOrigin: string;
  try {
    callbackOrigin = new URL(callbackUrl).origin;
  } catch {
    return false;
  }

  const allowedOrigins = new Set<string>([new URL(req.url).origin]);
  for (const value of [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    if (!value) {
      continue;
    }
    try {
      const normalized =
        value.startsWith("http://") || value.startsWith("https://")
          ? value
          : `https://${value}`;
      allowedOrigins.add(new URL(normalized).origin);
    } catch {
      // Ignore malformed env values.
    }
  }

  return allowedOrigins.has(callbackOrigin);
}
