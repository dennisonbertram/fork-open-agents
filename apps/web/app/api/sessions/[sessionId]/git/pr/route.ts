import { openPullRequest } from "@/lib/github/actions/pr";
import { checkPullRequest } from "@/lib/github/queries/pr";
import { openPullRequestRequestSchema } from "@/lib/git/http-schemas";
import { mapGitActionError } from "../_lib/git-errors";
import {
  jsonError,
  readJsonBody,
  requireGitSession,
  type RouteContext,
} from "../_lib/git-route";

export async function GET(_req: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const gate = await requireGitSession(sessionId);
  if (!gate.ok) {
    return gate.response;
  }

  try {
    const result = await checkPullRequest({ sessionId });
    return Response.json(result);
  } catch (error) {
    return mapGitActionError(error);
  }
}

export async function POST(req: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const gate = await requireGitSession(sessionId);
  if (!gate.ok) {
    return gate.response;
  }

  const parsed = openPullRequestRequestSchema.safeParse(
    await readJsonBody(req),
  );
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  try {
    const result = await openPullRequest({ sessionId, ...parsed.data });
    return Response.json(result);
  } catch (error) {
    return mapGitActionError(error);
  }
}
