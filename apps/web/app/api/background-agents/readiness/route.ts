import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getBackgroundAgentReadiness } from "@/lib/background-agents/readiness";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  return Response.json(getBackgroundAgentReadiness());
}
