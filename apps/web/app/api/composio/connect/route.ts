import { z } from "zod";
import { getComposioClient } from "@/lib/composio/client";
import { toComposioUserId } from "@/lib/composio/user-id";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

/**
 * Accept either toolkitSlug (preferred — one-click managed OAuth via
 * toolkits.authorize) or authConfigId (advanced escape hatch for custom OAuth
 * apps). At least one of the two must be present.
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = connectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Composio connect payload" },
      { status: 400 },
    );
  }

  try {
    const client = getComposioClient();
    const composioUserId = toComposioUserId(authResult.userId);

    if (parsed.data.toolkitSlug) {
      // Preferred path: one-click OAuth via toolkits.authorize
      // Composio auto-creates or selects a managed auth config — no authConfigId needed
      const connectionRequest = await client.toolkits.authorize(
        composioUserId,
        parsed.data.toolkitSlug,
      );

      return Response.json({
        id: connectionRequest.id,
        redirectUrl: connectionRequest.redirectUrl,
      });
    }

    // Advanced escape hatch: caller provides explicit authConfigId
    const connectionRequest = await client.connectedAccounts.link(
      composioUserId,
      parsed.data.authConfigId as string,
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
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: message || "Failed to create Composio connection link" },
      { status: 400 },
    );
  }
}
