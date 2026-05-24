import { z } from "zod";
import { getComposioClient } from "@/lib/composio/client";
import { toComposioUserId } from "@/lib/composio/user-id";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

const connectRequestSchema = z.object({
  authConfigId: z.string().trim().min(1),
  alias: z.string().trim().min(1).max(80).optional(),
  callbackUrl: z.url().optional(),
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
    const connectionRequest = await client.connectedAccounts.link(
      toComposioUserId(authResult.userId),
      parsed.data.authConfigId,
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
