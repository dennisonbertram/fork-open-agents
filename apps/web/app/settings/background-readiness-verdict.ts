import type {
  ReadinessCheck,
  ReadinessStatus,
} from "@/components/ui/readiness-verdict";

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
 * Maps a BackgroundReadinessResponse to a ReadinessVerdictProps-compatible shape.
 *
 * Mapping rules:
 * - ready === true  → status "ready", headline is a plain confirmation sentence.
 * - ready === false && enabled === true → status "action-needed", headline asks for
 *   setup, subtext counts the missing prerequisites.
 * - enabled === false → status "unavailable", headline tells the user the feature is
 *   off on this deployment, subtext points them to the workspace administrator.
 *
 * Raw env-var names (e.g. GITHUB_APP_ID) are placed exclusively in the mapped
 * checks[].missing arrays so they appear only inside the collapsed "Operator details"
 * disclosure rendered by <ReadinessVerdict>.  They MUST NOT appear in the headline or
 * subtext.
 */
export function mapReadinessToVerdict(
  response: BackgroundReadinessResponse,
): ReadinessVerdictData {
  const checks: ReadinessCheck[] = response.checks.map((check) => ({
    id: check.id,
    label: check.label,
    status: check.status,
    detail: check.detail,
    missing: check.missing.length > 0 ? check.missing : undefined,
  }));

  if (response.ready) {
    return {
      status: "ready",
      headline: "Hosted prerequisites are configured.",
      checks,
    };
  }

  if (response.enabled) {
    const count = response.missing.length;
    const noun = count === 1 ? "prerequisite" : "prerequisites";
    const verb = count === 1 ? "needs" : "need";
    return {
      status: "action-needed",
      headline: "Background agents need a bit more setup.",
      subtext: `${count} ${noun} ${verb} attention.`,
      checks,
    };
  }

  return {
    status: "unavailable",
    headline: "Background agents aren't enabled on this deployment.",
    subtext: "Ask your workspace administrator to enable them.",
    checks,
  };
}
