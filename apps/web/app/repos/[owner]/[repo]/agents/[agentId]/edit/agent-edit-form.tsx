"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  buildAgentPayload,
  buildFormFromAgent,
  type FormState,
} from "@/lib/background-agents/agent-spec";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { AgentSpecEditor } from "../../agent-spec-editor";

// Re-export for testing
export { buildAgentPayload as buildEditPatch };

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

type AgentEditFormProps = {
  agent: BackgroundAgentWithTriggers;
  owner: string;
  repo: string;
};

/**
 * Client component that wraps AgentSpecEditor for editing an existing agent.
 * Pre-fills all fields from the agent via buildFormFromAgent, then PATCHes
 * the API on save.
 */
export function AgentEditForm({ agent, owner, repo }: AgentEditFormProps) {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const form = buildFormFromAgent(agent);
  const detailHref = `/repos/${owner}/${repo}/agents/${agent.id}`;

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setSaveError(null);
    try {
      const res = await fetch(`/api/background-agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        error?: string;
        details?: Record<string, string[]>;
      };
      if (!res.ok) {
        const detail =
          body.error ??
          (body.details
            ? Object.values(body.details).flat().join("; ")
            : "Failed to save agent");
        setSaveError(detail);
        return;
      }
      toast.success("Agent updated.");
      router.push(detailHref);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save agent");
    }
  }

  async function handleRunTest() {
    setRunError(null);
    try {
      const res = await fetch(`/api/background-agents/${agent.id}/test`, {
        method: "POST",
      });
      const body = (await res.json()) as ManualTestResponse;
      if (!res.ok) {
        setRunError(body.error ?? "Failed to start test run");
        return;
      }
      const runId = body.runIds[0];
      if (!runId) {
        setRunError("No background run was created for this test");
        return;
      }
      router.push(`/background-runs/${runId}`);
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Failed to start test run",
      );
    }
  }

  return (
    <div className="space-y-6">
      <AgentSpecEditor
        mode="edit"
        repoOwner={owner}
        repoName={repo}
        initialName={form.name}
        initialGoal={agent.description ?? ""}
        initialTriggerKind={form.triggerKind}
        initialInstructions={form.instructions}
        initialOutputMode={form.outputMode}
        initialCheckCommand={form.checkCommand}
        initialEnabled={form.enabled}
        initialSchedule={form.schedule}
        initialConditionActions={form.conditionActions}
        initialConditionBranches={form.conditionBranches}
        initialConditionLabels={form.conditionLabels}
        initialConditionEnvironments={form.conditionEnvironments}
        initialConditionSeverities={form.conditionSeverities}
        onSave={handleSave}
        onRunTest={handleRunTest}
      />
      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}
      {runError && (
        <p className="text-sm text-destructive" role="alert">
          {runError}
        </p>
      )}
    </div>
  );
}

// Pure helper for testing: same as buildAgentPayload from agent-spec
export { buildFormFromAgent };
export type { FormState };
