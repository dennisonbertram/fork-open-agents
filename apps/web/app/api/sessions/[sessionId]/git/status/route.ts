import { getGitStatus } from "@/lib/git/queries/status";
import { mapGitActionError } from "../_lib/git-errors";
import { requireGitSession, type RouteContext } from "../_lib/git-route";

export async function GET(_req: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const gate = await requireGitSession(sessionId);
  if (!gate.ok) {
    return gate.response;
  }

  try {
    const status = await getGitStatus({ sessionId });
    return Response.json({ status });
  } catch (error) {
    return mapGitActionError(error);
  }
}
