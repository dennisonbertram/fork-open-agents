import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  createApiToken,
  listApiTokensForUser,
  revokeApiToken,
} from "@/lib/api-auth/tokens";
import { createApiTokenSchema } from "@/lib/agent-api-runs/schemas";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const tokens = await listApiTokensForUser(auth.userId);
  return Response.json({ tokens });
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createApiTokenSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid API token request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await createApiToken({
    userId: auth.userId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    allowedRepositories: parsed.data.allowedRepositories,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });

  return Response.json({ token: result.token, rawToken: result.rawToken });
}

export async function DELETE(req: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const tokenId = searchParams.get("tokenId");
  if (!tokenId) {
    return Response.json({ error: "tokenId is required" }, { status: 400 });
  }

  const token = await revokeApiToken({ userId: auth.userId, tokenId });
  if (!token) {
    return Response.json({ error: "Token not found" }, { status: 404 });
  }

  return Response.json({ token });
}
