"use client";

import { PlugZap, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import {
  buildAgentPayload,
  type GitHubAccessLevel,
  type GithubActions,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import {
  mapReadinessToVerdict,
  type BackgroundReadinessCheck,
  type BackgroundReadinessResponse,
} from "@/app/settings/background-readiness-verdict";
import { AgentSpecEditor } from "../agent-spec-editor";
import {
  getBlankTemplate,
  type AgentTemplate,
  type BlankTemplate,
} from "../agent-templates";
import { TemplatePicker } from "../template-picker";
import { submitNewAgent } from "./create-agent-request";
import { submitAgentUpdate } from "./update-agent-request";

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

type BackgroundAgentRepoReadiness = {
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

type NewAgentReadinessResponse = BackgroundReadinessResponse & {
  repoAccess?: BackgroundAgentRepoReadiness;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load");
  }
  return (await response.json()) as T;
}

function buildReadinessUrl(owner: string, repo: string): string {
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
  if (!repoAccess) {
    return null;
  }

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

function buildCombinedReadiness(
  readinessData: NewAgentReadinessResponse,
): BackgroundReadinessResponse {
  const repoAccessCheck = buildRepoAccessCheck(readinessData.repoAccess);
  const repoAccessReady = readinessData.repoAccess?.ready ?? true;
  const repoAccessMissing =
    repoAccessCheck && repoAccessCheck.missing.length > 0
      ? repoAccessCheck.missing
      : [];

  return {
    enabled: readinessData.enabled,
    ready: readinessData.ready && repoAccessReady,
    missing: Array.from(
      new Set([...readinessData.missing, ...repoAccessMissing]),
    ),
    checks: repoAccessCheck
      ? [...readinessData.checks, repoAccessCheck]
      : readinessData.checks,
  };
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [saveVerb, setSaveVerb] = useState<"created" | "updated">("created");

  const {
    data: readinessData,
    isLoading: readinessLoading,
    mutate: mutateReadiness,
  } = useSWR<NewAgentReadinessResponse>(
    buildReadinessUrl(owner, repo),
    fetchJson,
  );

  function handleSelectTemplate(template: AgentTemplate | BlankTemplate) {
    setSelectedTemplate(template);
    setStep("edit-spec");
    setMessage(null);
  }

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setMessage(null);
    setSaveError(null);
    const isUpdate = createdAgentId !== null;
    const result = isUpdate
      ? await submitAgentUpdate(createdAgentId, payload)
      : await submitNewAgent(payload);
    if (result.ok) {
      // CRITICAL: stay on this page — do NOT navigate. Set the id so
      // "Run a test" becomes enabled.
      setCreatedAgentId(result.agentId);
      setSaveVerb(isUpdate ? "updated" : "created");
      toast.success(isUpdate ? "Agent updated." : "Agent created successfully.");
    } else {
      setSaveError(result.error);
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
  const readinessPanel = readinessData ? (
    <ReadinessVerdict
      {...mapReadinessToVerdict(buildCombinedReadiness(readinessData))}
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
        testRunId={testRunId}
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
              ? "Agent updated."
              : "Agent created successfully."}
          </p>
          <Button asChild className="mt-2" size="sm" variant="outline">
            <Link href={`/repos/${owner}/${repo}/agents/${createdAgentId}`}>
              View agent
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
