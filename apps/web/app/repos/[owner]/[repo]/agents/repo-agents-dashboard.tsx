"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  buildAgentPayload,
  type OutputMode,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import { AgentSpecEditor } from "./agent-spec-editor";
import {
  getBlankTemplate,
  type AgentTemplate,
  type BlankTemplate,
} from "./agent-templates";
import { TemplatePicker } from "./template-picker";
import {
  firstFieldError,
  type FlattenedZodDetails,
} from "@/lib/background-agents/validation-details";

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

type CreatedAgent = {
  id: string;
};

type CreateAgentResponse = {
  agent: CreatedAgent;
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

type Step = "list" | "pick-template" | "edit-spec";

type RepoAgentsDashboardProps = {
  owner: string;
  repo: string;
};

/**
 * Client component for the New Agent creation flow on the repo agents page.
 * Entry: "New Agent" button → template picker → spec editor → save/test.
 */
export function RepoAgentsDashboard({ owner, repo }: RepoAgentsDashboardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("list");
  const [selectedTemplate, setSelectedTemplate] = useState<
    AgentTemplate | BlankTemplate | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  const { data: readinessData } = useSWR<BackgroundReadinessResponse>(
    "/api/background-agents/readiness",
    fetchJson,
  );

  function handleSelectTemplate(template: AgentTemplate | BlankTemplate) {
    setSelectedTemplate(template);
    setStep("edit-spec");
    setMessage(null);
  }

  function handleCancel() {
    setStep("list");
    setSelectedTemplate(null);
    setMessage(null);
    setCreatedAgentId(null);
  }

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setMessage(null);
    try {
      const response = await fetch("/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          details?: FlattenedZodDetails;
        };
        const fieldError = firstFieldError(errorBody.details);
        throw new Error(fieldError ?? "Failed to create background agent");
      }
      const body = (await response.json()) as CreateAgentResponse;
      setCreatedAgentId(body.agent.id);
      setMessage("Agent created successfully.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create agent");
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
      router.push(`/background-runs/${runId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to run test");
    }
  }

  const template = selectedTemplate ?? getBlankTemplate();

  if (step === "pick-template") {
    return (
      <section className="rounded-md border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">New Agent — choose a template</h2>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
        <div className="p-4">
          <TemplatePicker onSelect={handleSelectTemplate} />
        </div>
      </section>
    );
  }

  if (step === "edit-spec") {
    return (
      <section className="rounded-md border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">New Agent — review spec</h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
        <div className="p-4">
          {readinessData && !readinessData.ready && (
            <div className="mb-4 rounded-md border border-amber-500/25 bg-amber-50/30 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
              {readinessData.missing.length} background agent prerequisite
              {readinessData.missing.length === 1 ? "" : "s"} not yet
              configured. The agent can be created but may not run until setup
              is complete.
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
              "defaultSchedule" in template
                ? template.defaultSchedule
                : undefined
            }
            onSave={handleSave}
            onRunTest={handleRunTest}
          />
          {message && (
            <p className="mt-4 text-xs text-muted-foreground">{message}</p>
          )}
        </div>
      </section>
    );
  }

  // Default "list" step — just the New Agent entry point
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => setStep("pick-template")}>
        <Plus className="h-4 w-4" />
        New Agent
      </Button>
    </div>
  );
}
