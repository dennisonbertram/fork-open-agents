import { listBackgroundAgentRuns } from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { toPublicBackgroundAgentRun } from "@/lib/background-agents/public-run";

function getLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 50;
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
}

export async function GET(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const runs = await listBackgroundAgentRuns({
    userId: authResult.userId,
    repoOwner: url.searchParams.get("repoOwner") ?? undefined,
    repoName: url.searchParams.get("repoName") ?? undefined,
    limit: getLimit(url.searchParams.get("limit")),
  });

  return Response.json({
    runs: runs.map((run) =>
      "executionSnapshot" in run
        ? toPublicBackgroundAgentRun(
            run as Parameters<typeof toPublicBackgroundAgentRun>[0],
          )
        : run,
    ),
  });
}
