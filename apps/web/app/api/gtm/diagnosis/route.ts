import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { isGtmDiagnosisSource } from "@/lib/gtm-coordinator/diagnosis";
import { buildDbBackedGtmDiagnosis } from "@/lib/gtm-coordinator/diagnosis-store";

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

  if (!isGtmDiagnosisSource(source)) {
    return Response.json(
      {
        error: "Invalid source",
        supportedSources: [
          "account_work",
          "product_shipments",
          "inbound",
          "distribution",
          "audience",
        ],
      },
      { status: 400 },
    );
  }

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const diagnosis = await buildDbBackedGtmDiagnosis({
    userId: authResult.userId,
    source,
    id,
    limit: parseLimit(url.searchParams.get("limit")),
  });

  if (!diagnosis) {
    return Response.json({ error: "GTM item not found" }, { status: 404 });
  }

  return Response.json(diagnosis);
}
