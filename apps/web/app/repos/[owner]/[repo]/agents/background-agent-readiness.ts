import {
  mapReadinessToVerdict,
  type BackgroundReadinessCheck,
  type BackgroundReadinessResponse,
  type ReadinessVerdictData,
} from "@/app/settings/background-readiness-verdict";

export type BackgroundAgentRepoReadiness = {
  ready: boolean;
  repoOwner: string;
  repoName: string;
  requiredUserPermission: "read" | "write";
  reason: string | null;
  message: string;
  installationId: number | null;
  repositoryId: number | null;
  defaultBranch: string | null;
};

export type AgentReadinessResponse = BackgroundReadinessResponse & {
  repoAccess?: BackgroundAgentRepoReadiness;
};

export async function fetchAgentReadiness<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load");
  return (await response.json()) as T;
}

export function buildAgentReadinessUrl(owner: string, repo: string): string {
  const params = new URLSearchParams({
    repoOwner: owner,
    repoName: repo,
    permission: "write",
  });
  return `/api/background-agents/readiness?${params.toString()}`;
}

function buildRepoAccessCheck(
  repoAccess: BackgroundAgentRepoReadiness | undefined,
): BackgroundReadinessCheck | null {
  if (!repoAccess) return null;
  return {
    id: "repo_access",
    label: "Repository access",
    status: repoAccess.ready ? "ready" : "missing",
    detail: repoAccess.message,
    missing: repoAccess.ready
      ? []
      : [
          `${repoAccess.repoOwner}/${repoAccess.repoName} ${repoAccess.requiredUserPermission} access`,
        ],
  };
}

export function buildCombinedAgentReadiness(
  readinessData: AgentReadinessResponse,
): BackgroundReadinessResponse {
  const repoAccessCheck = buildRepoAccessCheck(readinessData.repoAccess) ?? {
    id: "repo_access",
    label: "Repository access",
    status: "missing" as const,
    detail: "Repository access readiness was not returned.",
    missing: ["Repository access readiness"],
  };
  const repoAccessReady = readinessData.repoAccess?.ready ?? false;
  const repoAccessMissing = repoAccessCheck.missing;
  return {
    enabled: readinessData.enabled,
    ready: readinessData.ready && repoAccessReady,
    missing: Array.from(
      new Set([...readinessData.missing, ...repoAccessMissing]),
    ),
    checks: [...readinessData.checks, repoAccessCheck],
  };
}

export function isAgentReadinessReady(
  readiness: BackgroundReadinessResponse | undefined,
): boolean {
  return Boolean(readiness?.enabled && readiness.ready);
}

export function mapAgentReadinessToVerdict(
  readiness: BackgroundReadinessResponse,
  surface: "legacy" | "automation",
): ReadinessVerdictData {
  const verdict = mapReadinessToVerdict(readiness);
  if (surface === "legacy") return verdict;
  if (verdict.status === "ready") {
    return { ...verdict, headline: "Automation prerequisites are ready." };
  }
  if (verdict.status === "action-needed") {
    return { ...verdict, headline: "Automation needs a bit more setup." };
  }
  return {
    ...verdict,
    headline: "Automations aren't enabled on this deployment.",
  };
}
