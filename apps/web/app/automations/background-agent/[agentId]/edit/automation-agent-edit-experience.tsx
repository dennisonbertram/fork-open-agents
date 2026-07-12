"use client";

import useSWR from "swr";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { AgentEditForm } from "@/app/repos/[owner]/[repo]/agents/[agentId]/edit/agent-edit-form";
import {
  buildAgentReadinessUrl,
  buildCombinedAgentReadiness,
  fetchAgentReadiness,
  isAgentReadinessReady,
  mapAgentReadinessToVerdict,
  type AgentReadinessResponse,
} from "@/app/repos/[owner]/[repo]/agents/background-agent-readiness";

export function AutomationAgentEditExperience({
  agent,
}: {
  agent: BackgroundAgentWithTriggers;
}) {
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useSWR<AgentReadinessResponse>(
    buildAgentReadinessUrl(agent.repoOwner, agent.repoName),
    fetchAgentReadiness,
  );
  const readiness = data ? buildCombinedAgentReadiness(data) : undefined;
  const readinessReady = isAgentReadinessReady(readiness);

  return (
    <div className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-pretty text-sm text-destructive"
        >
          Readiness could not be verified. Enabling remains unavailable until
          the checks load successfully.
        </div>
      ) : readiness ? (
        <ReadinessVerdict
          {...mapAgentReadinessToVerdict(readiness, "automation")}
          onRefresh={() => void refresh()}
          refreshing={isLoading}
        />
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-pretty text-sm text-muted-foreground">
          Checking Automation prerequisites. Enabling remains unavailable while
          readiness is unknown.
        </div>
      )}

      <AgentEditForm
        agent={agent}
        owner={agent.repoOwner}
        repo={agent.repoName}
        surface="automation"
        readinessReady={readinessReady}
      />
    </div>
  );
}
