import { generatePrContent } from "@/lib/github/actions/pr";
import { generatePrContentRequestSchema } from "@/lib/git/http-schemas";
import { mapGitActionError } from "../../_lib/git-errors";
import {
  jsonError,
  readJsonBody,
  requireGitSession,
  type RouteContext,
} from "../../_lib/git-route";

export async function POST(req: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const gate = await requireGitSession(sessionId);
  if (!gate.ok) {
    return gate.response;
  }

  const parsed = generatePrContentRequestSchema.safeParse(
    await readJsonBody(req),
  );
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  try {
    const result = await generatePrContent({ sessionId, ...parsed.data });
    return Response.json(result);
  } catch (error) {
    return mapGitActionError(error);
  }
}
