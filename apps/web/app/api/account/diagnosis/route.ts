import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { isAccountDiagnosisSource } from "@/lib/account-coordinator/diagnosis";
import { buildDbBackedAccountDiagnosis } from "@/lib/account-coordinator/diagnosis-store";

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const id = url.searchParams.get("id");

  if (!isAccountDiagnosisSource(source)) {
    return Response.json(
      {
        error: "Invalid source",
        supportedSources: [
          "session",
          "chat_workflow",
          "background_agent",
          "agent_loop",
        ],
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  if (!id) {
    return Response.json(
      { error: "Missing id", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const diagnosis = await buildDbBackedAccountDiagnosis({
    userId: authResult.userId,
    source,
    id,
    limit: parseLimit(url.searchParams.get("limit")),
  });

  if (!diagnosis) {
    return Response.json(
      { error: "Work item not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json(diagnosis);
}
