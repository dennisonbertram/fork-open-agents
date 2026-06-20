import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { buildDbBackedAccountSnapshot } from "@/lib/account-coordinator/store";

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const snapshot = await buildDbBackedAccountSnapshot({
    userId: authResult.userId,
    window: url.searchParams.get("window"),
  });

  return Response.json(snapshot);
}
