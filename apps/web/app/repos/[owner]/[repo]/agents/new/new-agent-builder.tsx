"use client";

import { PlugZap, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import {
  buildAgentPayload,
  type GitHubAccessLevel,
  type OutputMode,
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

type FeedbackMessage = {
  kind: "success" | "error";
  text: string;
};

type DraftStatusMessage = {
  kind: "loading" | "error";
  text: string;
};

type DraftAgentResponse = {
  draft: {
    name: string;
    goal: string;
    triggerKind: TriggerKind;
    instructions: string;
    outputMode: OutputMode;
    checkCommand: string;
    schedule: string;
    conditionActions: string;
    conditionBranches: string;
    conditionLabels: string;
    conditionEnvironments: string;
    conditionSeverities: string;
  };
};

const draftRequestCache = new Map<string, Promise<DraftAgentResponse>>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load");
  }
  return (await response.json()) as T;
}

function buildDraftCacheKey(owner: string, repo: string, prompt: string) {
  return `${owner}/${repo}:${prompt}`;
}

function requestAgentDraft(input: {
  owner: string;
  repo: string;
  prompt: string;
}): Promise<DraftAgentResponse> {
  const cacheKey = buildDraftCacheKey(input.owner, input.repo, input.prompt);
  const cached = draftRequestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = fetch("/api/background-agents/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: input.prompt,
      repoOwner: input.owner,
      repoName: input.repo,
    }),
  })
    .then(async (response) => {
      const body = (await response.json()) as
        | DraftAgentResponse
        | { error?: string };
      if (!response.ok || !("draft" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Couldn't generate an agent spec. Try again.",
        );
      }
      return body;
    })
    .catch((error: unknown) => {
      draftRequestCache.delete(cacheKey);
      throw error;
    });

  draftRequestCache.set(cacheKey, request);
  return request;
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
  aiPrompt?: string | null;
};

/**
 * Client component for the /agents/new full-page builder.
 * Template-first: shows TemplatePicker first, then AgentSpecEditor.
 * After save, STAYS on the page (no router.push) so "Run a test" works.
 */
export function NewAgentBuilder({
  owner,
  repo,
  aiPrompt = null,
}: NewAgentBuilderProps) {
  const [step, setStep] = useState<Step>("pick-template");
  const [selectedTemplate, setSelectedTemplate] = useState<
    AgentTemplate | BlankTemplate | null
  >(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatusMessage | null>(
    aiPrompt
      ? {
          kind: "loading",
          text: "Drafting an agent spec from your description.",
        }
      : null,
  );
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const userSelectedTemplateRef = useRef(false);

  const {
    data: readinessData,
    isLoading: readinessLoading,
    mutate: mutateReadiness,
  } = useSWR<NewAgentReadinessResponse>(
    buildReadinessUrl(owner, repo),
    fetchJson,
  );

  function handleSelectTemplate(template: AgentTemplate | BlankTemplate) {
    userSelectedTemplateRef.current = true;
    setSelectedTemplate(template);
    setStep("edit-spec");
    setMessage(null);
    setDraftStatus(null);
  }

  useEffect(() => {
    const prompt = aiPrompt?.trim();
    if (!prompt) {
      return;
    }
    const draftPrompt = prompt;

    userSelectedTemplateRef.current = false;
    let ignore = false;

    async function draftAgent() {
      setDraftStatus({
        kind: "loading",
        text: "Drafting an agent spec from your description.",
      });
      try {
        const body = await requestAgentDraft({
          owner,
          repo,
          prompt: draftPrompt,
        });
        if (ignore || userSelectedTemplateRef.current) {
          return;
        }
        setSelectedTemplate({
          name: body.draft.name,
          goal: body.draft.goal,
          triggerKind: body.draft.triggerKind,
          instructions: body.draft.instructions,
          outputMode: body.draft.outputMode,
          defaultCheckCommand: body.draft.checkCommand,
          defaultEnabled: false,
          defaultSchedule: body.draft.schedule || undefined,
          defaultConditionActions: body.draft.conditionActions,
          defaultConditionBranches: body.draft.conditionBranches,
          defaultConditionLabels: body.draft.conditionLabels,
          defaultConditionEnvironments: body.draft.conditionEnvironments,
          defaultConditionSeverities: body.draft.conditionSeverities,
        });
        setStep("edit-spec");
        setDraftStatus(null);
        setMessage({
          kind: "success",
          text: "Draft generated. Review it, then save when it looks right.",
        });
      } catch (err) {
        if (ignore || userSelectedTemplateRef.current) {
          return;
        }
        setDraftStatus({
          kind: "error",
          text:
            err instanceof Error
              ? err.message
              : "Couldn't generate an agent spec. Try again.",
        });
      }
    }

    void draftAgent();

    return () => {
      ignore = true;
    };
  }, [aiPrompt, owner, repo]);

  async function handleSave(payload: ReturnType<typeof buildAgentPayload>) {
    setMessage(null);
    const result = await submitNewAgent(payload);
    if (result.ok) {
      // CRITICAL: stay on this page — do NOT navigate. Set the id so
      // "Run a test" becomes enabled.
      setCreatedAgentId(result.agentId);
      setMessage({ kind: "success", text: "Agent created successfully." });
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  async function handleRunTest() {
    if (!createdAgentId) {
      setMessage({
        kind: "error",
        text: "Save the agent first before running a test.",
      });
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
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to run test",
      });
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
        {draftStatus ? (
          <p
            aria-live="polite"
            className={`rounded-md border px-3 py-2 text-xs ${
              draftStatus.kind === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-muted/20 text-muted-foreground"
            }`}
            role="status"
          >
            {draftStatus.text}
          </p>
        ) : null}
        <TemplatePicker onSelect={handleSelectTemplate} />
      </div>
    );
  }

  // edit-spec step
  const initialAccessLevel: GitHubAccessLevel =
    template.outputMode === "ready_pr" ? "write" : "read";

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
        initialOutputMode={template.outputMode as OutputMode}
        initialCheckCommand={template.defaultCheckCommand}
        initialEnabled={false}
        initialSchedule={
          "defaultSchedule" in template ? template.defaultSchedule : undefined
        }
        initialConditionActions={template.defaultConditionActions ?? ""}
        initialConditionBranches={template.defaultConditionBranches ?? ""}
        initialConditionLabels={template.defaultConditionLabels ?? ""}
        initialConditionEnvironments={
          template.defaultConditionEnvironments ?? ""
        }
        initialConditionSeverities={template.defaultConditionSeverities ?? ""}
        initialPermissionContents={initialAccessLevel}
        initialPermissionPullRequests={initialAccessLevel}
        initialComposioToolkitSlugs={[]}
        createdAgentId={createdAgentId}
        testRunId={testRunId}
        statusMessage={message}
        onSave={handleSave}
        onRunTest={handleRunTest}
      />
    </div>
  );
}
