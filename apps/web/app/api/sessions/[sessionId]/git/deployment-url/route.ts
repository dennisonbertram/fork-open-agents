import { getDeploymentUrl } from "@/lib/github/queries/deployment";
import { deploymentUrlQuerySchema } from "@/lib/git/http-schemas";
import { mapGitActionError } from "../_lib/git-errors";
import {
  jsonError,
  requireGitSession,
  type RouteContext,
} from "../_lib/git-route";

export async function GET(req: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const gate = await requireGitSession(sessionId);
  if (!gate.ok) {
    return gate.response;
  }

  const params = new URL(req.url).searchParams;
  const parsed = deploymentUrlQuerySchema.safeParse({
    prNumber: params.get("prNumber") ?? undefined,
    branch: params.get("branch") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid query", 400);
  }

  try {
    const result = await getDeploymentUrl({ sessionId, ...parsed.data });
    return Response.json(result);
  } catch (error) {
    return mapGitActionError(error);
  }
}
