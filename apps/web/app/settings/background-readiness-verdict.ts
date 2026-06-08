import type { ReadinessCheck, ReadinessStatus } from "@/components/ui/readiness-verdict";

export type BackgroundReadinessCheck = {
  id: string;
  label: string;
  status: "ready" | "missing" | "disabled";
  detail: string;
  missing: string[];
};

export type BackgroundReadinessResponse = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  checks: BackgroundReadinessCheck[];
};

export type ReadinessVerdictData = {
  status: ReadinessStatus;
  headline: string;
  subtext?: string;
  checks?: ReadinessCheck[];
};

/**
 * Maps a BackgroundReadinessResponse to ReadinessVerdictProps-compatible shape.
 * Stub — implementation intentionally missing so tests fail with behavioral errors.
 */
export function mapReadinessToVerdict(
  _response: BackgroundReadinessResponse,
): ReadinessVerdictData {
  throw new Error("mapReadinessToVerdict is not yet implemented");
}
