"use client";

import { PlugZap, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import { canonicalBackgroundAutomationDetailUrl } from "@/lib/automations/definition-routes";
import {
  buildAgentPayload,
  type GitHubAccessLevel,
  type GithubActions,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import {
  buildAgentReadinessUrl,
  buildCombinedAgentReadiness,
  fetchAgentReadiness,
  isAgentReadinessReady,
  mapAgentReadinessToVerdict,
  type AgentReadinessResponse,
} from "../background-agent-readiness";
import { AgentSpecEditor } from "../agent-spec-editor";
import {
  getBlankTemplate,
  type AgentTemplate,
  type BlankTemplate,
} from "../agent-templates";
import { manualTestSkipMessages } from "../manual-test-feedback";
import type { ManualTestResponse } from "../manual-test-feedback";
import { TemplatePicker } from "../template-picker";
import { submitNewAgent } from "./create-agent-request";
import { submitAgentUpdate } from "./update-agent-request";

type Step = "pick-template" | "edit-spec";

type NewAgentBuilderProps = {
  owner: string;
  repo: string;
  surface?: "legacy" | "automation";
};

/**
 * Client component for the /agents/new full-page builder.
 * Template-first: shows TemplatePicker first, then AgentSpecEditor.
 * After save, STAYS on the page (no router.push) so "Run a test" works.
 */
export function NewAgentBuilder({
  owner,
  repo,
  surface = "legacy",
}: NewAgentBuilderProps) {
  const [step, setStep] = useState<Step>("pick-template");
  const [selectedTemplate, setSelectedTemplate] = useState<
    AgentTemplate | BlankTemplate | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testAlert, setTestAlert] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [saveVerb, setSaveVerb] = useState<"created" | "updated">("created");
  const [persistedEnabled, setPersistedEnabled] = useState(false);

  const {
    data: readinessData,
    isLoading: readinessLoading,
    mutate: mutateReadiness,
  } = useSWR<AgentReadinessResponse>(
    buildAgentReadinessUrl(owner, repo),
    fetchAgentReadiness,
  );
  const combinedReadiness = readinessData
    ? buildCombinedAgentReadiness(readinessData)
    : undefined;
  const readinessReady = isAgentReadinessReady(combinedReadiness);

  function handleSelectTemplate(template: AgentTemplate | BlankTemplate) {
    setSelectedTemplate(template);
    setStep("edit-spec");
    setMessage(null);
  }

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setMessage(null);
    setSaveError(null);
    setTestAlert(null);
    const isUpdate = createdAgentId !== null;
    const result = isUpdate
      ? await submitAgentUpdate(createdAgentId, payload)
      : await submitNewAgent(payload);
    if (result.ok) {
      // CRITICAL: stay on this page — do NOT navigate. Set the id so
      // "Run a test" becomes enabled.
      setCreatedAgentId(result.agentId);
      setPersistedEnabled(payload.status === "enabled");
      setSaveVerb(isUpdate ? "updated" : "created");
      toast.success(
        surface === "automation"
          ? isUpdate
            ? "Automation updated."
            : "Automation created disabled."
          : isUpdate
            ? "Agent updated."
            : "Agent created successfully.",
      );
    } else {
      setSaveError(result.error);
    }
  }

  async function handleRunTest() {
    if (!createdAgentId || (surface === "automation" && !persistedEnabled)) {
      setMessage(
        surface === "automation"
          ? "Enable and save the Automation before running a manual test."
          : "Save the agent first before running a test.",
      );
      return;
    }
    setMessage(null);
    setTestAlert(null);
    try {
      const response = await fetch(
        `/api/background-agents/${createdAgentId}/test`,
        { method: "POST" },
      );
      const body = (await response.json()) as ManualTestResponse;
      if (!response.ok) {
        setTestAlert(body.error ?? "Failed to start test");
        return;
      }
      if (body.skipReason) {
        setTestAlert(manualTestSkipMessages[body.skipReason]);
        return;
      }
      const runId = body.runIds[0];
      if (!runId) {
        setTestAlert("No background run was created for this test");
        return;
      }
      // Stay on page — show inline console
      setTestRunId(runId);
    } catch (err) {
      setTestAlert(err instanceof Error ? err.message : "Failed to run test");
    }
  }

  const template = selectedTemplate ?? getBlankTemplate();
  const readinessPanel = readinessData ? (
    <ReadinessVerdict
      {...mapAgentReadinessToVerdict(combinedReadiness!, surface)}
      action={
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/background-agents">
              <Settings2 className="h-3.5 w-3.5" />
              Open background agent settings
            </Link>
          </Button>
          {readinessData.repoAccess?.ready === false ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/settings/connections">
                <PlugZap className="h-3.5 w-3.5" />
                Manage GitHub connection
              </Link>
            </Button>
          ) : null}
        </div>
      }
      onRefresh={() => void mutateReadiness()}
      refreshing={readinessLoading}
    />
  ) : (
    <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
      Checking background agent prerequisites.
    </div>
  );

  if (step === "pick-template") {
    return (
      <div className="space-y-4">
        {readinessPanel}
        <TemplatePicker onSelect={handleSelectTemplate} />
      </div>
    );
  }

  // edit-spec step
  const templateGithubActions: GithubActions =
    "githubActions" in template
      ? template.githubActions
      : { open_pull_request: true, comment_on_pr_or_issue: true };
  const templateRequiresWrite = Boolean(
    templateGithubActions.open_pull_request ||
    templateGithubActions.approve_pull_request ||
    templateGithubActions.request_changes ||
    templateGithubActions.merge_pull_request ||
    templateGithubActions.push ||
    templateGithubActions.delete_branch,
  );
  const initialAccessLevel: GitHubAccessLevel = templateRequiresWrite
    ? "write"
    : "read";

  return (
    <div className="space-y-4">
      {readinessPanel}
      <AgentSpecEditor
        repoOwner={owner}
        repoName={repo}
        initialName={template.name}
        initialGoal={template.goal}
        initialTriggerKind={template.triggerKind as TriggerKind}
        initialInstructions={template.instructions}
        initialCheckCommand={template.defaultCheckCommand}
        initialEnabled={false}
        initialSchedule={
          "defaultSchedule" in template ? template.defaultSchedule : undefined
        }
        initialPermissionContents={initialAccessLevel}
        initialPermissionPullRequests={initialAccessLevel}
        initialComposioToolkitSlugs={[]}
        initialGithubActions={templateGithubActions}
        createdAgentId={createdAgentId}
        surface={surface}
        readinessReady={readinessReady}
        persistedEnabled={persistedEnabled}
        testRunId={testRunId}
        testAlert={testAlert}
        onSave={handleSave}
        onRunTest={handleRunTest}
      />
      {createdAgentId && !saveError && (
        <div
          className="rounded-lg border border-border bg-muted/20 p-4 text-sm"
          role="status"
        >
          <p>
            {saveVerb === "updated"
              ? surface === "automation"
                ? "Automation updated."
                : "Agent updated."
              : surface === "automation"
                ? "Automation created disabled. Review readiness before enabling it."
                : "Agent created successfully."}
          </p>
          <Button asChild className="mt-2" size="sm" variant="outline">
            <Link
              href={
                surface === "automation"
                  ? canonicalBackgroundAutomationDetailUrl(createdAgentId)
                  : `/repos/${owner}/${repo}/agents/${createdAgentId}`
              }
            >
              {surface === "automation" ? "View Automation" : "View agent"}
            </Link>
          </Button>
        </div>
      )}
      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
