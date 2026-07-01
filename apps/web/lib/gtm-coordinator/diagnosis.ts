import type { GtmSnapshotSource } from "./types";

export function isGtmDiagnosisSource(
  source: string | null,
): source is GtmSnapshotSource {
  return (
    source === "account_work" ||
    source === "product_shipments" ||
    source === "inbound" ||
    source === "distribution" ||
    source === "audience"
  );
}
