/**
 * useAgentToolPreflight — SWR fetch hook for the agent tool preflight panel
 * (#802, epic #796 T6).
 *
 * Fetches predicted per-toolkit availability for the agent's next run from
 * the read-only GET /api/background-agents/:agentId/tool-preflight
 * endpoint. Matches the existing SWR pattern used by
 * useBackgroundRunPolling (../use-background-run-polling.ts) — no polling
 * interval here since this is a page-load-triggered snapshot, not a live
 * status feed.
 */
import useSWR from "swr";

export type AgentToolPreflightPredictedState =
  | "ready"
  | "blocked_by_repo_policy"
  | "not_connected"
  | "auth_expired"
  | "runtime_mode_incompatible"
  | "composio_unreachable";

export type AgentToolPreflightToolkit = {
  slug: string;
  predictedState: AgentToolPreflightPredictedState;
  policyReason?: "repo_policy_blocked" | "not_in_repo_allowlist";
  errorKind?: string;
};

export type AgentToolPreflightResponse = {
  toolkits: AgentToolPreflightToolkit[];
};

async function fetchToolPreflight(
  url: string,
): Promise<AgentToolPreflightResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load tool preflight");
  }
  return res.json() as Promise<AgentToolPreflightResponse>;
}

export function useAgentToolPreflight(agentId: string) {
  return useSWR<AgentToolPreflightResponse>(
    `/api/background-agents/${agentId}/tool-preflight`,
    fetchToolPreflight,
  );
}
