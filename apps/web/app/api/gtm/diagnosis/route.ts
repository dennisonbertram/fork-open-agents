import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { isGtmDiagnosisSource } from "@/lib/gtm-coordinator/diagnosis";
import { buildDbBackedGtmDiagnosis } from "@/lib/gtm-coordinator/diagnosis-store";

function parseLimit(
  value: string | null,
): { ok: true; value: number | undefined } | { ok: false } {
  if (!value) {
    return { ok: true, value: undefined };
  }

  if (!/^\d+$/.test(value)) {
    return { ok: false };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
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

  const limit = parseLimit(url.searchParams.get("limit"));
  if (!limit.ok) {
    return Response.json(
      {
        error: "Invalid limit",
        errorKind: "invalid_diagnosis_limit",
        supportedRange: "1 through 100",
      },
      { status: 400 },
    );
  }

  const diagnosis = await buildDbBackedGtmDiagnosis({
    userId: authResult.userId,
    source,
    id,
    limit: limit.value,
  });

  if (!diagnosis) {
    return Response.json({ error: "GTM item not found" }, { status: 404 });
  }

  return Response.json(diagnosis);
}
