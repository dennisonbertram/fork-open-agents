"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  buildAgentPayload,
  type GitHubAccessLevel,
  type OutputMode,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import { AgentSpecEditor } from "../agent-spec-editor";
import {
  getBlankTemplate,
  type AgentTemplate,
  type BlankTemplate,
} from "../agent-templates";
import { TemplatePicker } from "../template-picker";
import { submitNewAgent } from "./create-agent-request";

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

type BackgroundReadinessResponse = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load");
  }
  return (await response.json()) as T;
}

type Step = "pick-template" | "edit-spec";

type NewAgentBuilderProps = {
  owner: string;
  repo: string;
};

/**
 * Client component for the /agents/new full-page builder.
 * Template-first: shows TemplatePicker first, then AgentSpecEditor.
 * After save, STAYS on the page (no router.push) so "Run a test" works.
 */
export function NewAgentBuilder({ owner, repo }: NewAgentBuilderProps) {
  const [step, setStep] = useState<Step>("pick-template");
  const [selectedTemplate, setSelectedTemplate] = useState<
    AgentTemplate | BlankTemplate | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);

  const { data: readinessData } = useSWR<BackgroundReadinessResponse>(
    "/api/background-agents/readiness",
    fetchJson,
  );

  function handleSelectTemplate(template: AgentTemplate | BlankTemplate) {
    setSelectedTemplate(template);
    setStep("edit-spec");
    setMessage(null);
  }

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setMessage(null);
    const result = await submitNewAgent(payload);
    if (result.ok) {
      // CRITICAL: stay on this page — do NOT navigate. Set the id so
      // "Run a test" becomes enabled.
      setCreatedAgentId(result.agentId);
      setMessage("Agent created successfully.");
    } else {
      setMessage(result.error);
    }
  }

  async function handleRunTest() {
    if (!createdAgentId) {
      setMessage("Save the agent first before running a test.");
      return;
    }
    setMessage(null);
    try {
      const response = await fetch(
        `/api/background-agents/${createdAgentId}/test`,
        { method: "POST" },
      );
      const body = (await response.json()) as ManualTestResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to start test");
      }
      const runId = body.runIds[0];
      if (!runId) {
        throw new Error("No background run was created for this test");
      }
      // Stay on page — show inline console
      setTestRunId(runId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to run test");
    }
  }

  const template = selectedTemplate ?? getBlankTemplate();

  if (step === "pick-template") {
    return (
      <div>
        <TemplatePicker onSelect={handleSelectTemplate} />
      </div>
    );
  }

  // edit-spec step
  const initialAccessLevel: GitHubAccessLevel =
    template.outputMode === "ready_pr" ? "write" : "read";

  return (
    <div>
      {readinessData && !readinessData.ready && (
        <div className="mb-4 rounded-md border border-amber-500/25 bg-amber-50/30 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
          {readinessData.missing.length} background agent prerequisite
          {readinessData.missing.length === 1 ? "" : "s"} not yet configured.
          The agent can be created but may not run until setup is complete.
        </div>
      )}
      <AgentSpecEditor
        repoOwner={owner}
        repoName={repo}
        initialName={template.name}
        initialGoal={template.goal}
        initialTriggerKind={template.triggerKind as TriggerKind}
        initialInstructions={template.instructions}
        initialOutputMode={template.outputMode as OutputMode}
        initialCheckCommand={template.defaultCheckCommand}
        initialEnabled={false}
        initialSchedule={
          "defaultSchedule" in template ? template.defaultSchedule : undefined
        }
        initialPermissionContents={initialAccessLevel}
        initialPermissionPullRequests={initialAccessLevel}
        initialComposioToolkitSlugs={[]}
        createdAgentId={createdAgentId}
        testRunId={testRunId}
        onSave={handleSave}
        onRunTest={handleRunTest}
      />
      {message && (
        <p className="mt-4 text-xs text-muted-foreground">{message}</p>
      )}
    </div>
  );
}
