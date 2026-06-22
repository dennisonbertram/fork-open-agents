"use client";

import {
  Bot,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import {
  buildAgentPayload,
  buildFormFromAgent,
  conditionFieldLabel,
  defaultForm,
  describeOutputModePermissions,
  fieldsForTrigger,
  flowSteps,
  isStepValid,
  outputModeLabel,
  supportedOutputModes,
  triggerLabels,
  type BackgroundAgent,
  type ConditionField,
  type FormState,
  type OutputMode,
  type TriggerKind,
} from "./background-agents-form";
import {
  mapReadinessToVerdict,
  type BackgroundReadinessResponse,
} from "./background-readiness-verdict";
import {
  firstFieldError,
  type FlattenedZodDetails,
} from "@/lib/background-agents/validation-details";

type BackgroundAgentsResponse = {
  agents: BackgroundAgent[];
};

type BackgroundRun = {
  id: string;
  status: string;
  source: string;
  triggerKind: string;
  externalId: string;
  repoOwner: string;
  repoName: string;
  ref: string | null;
  sha: string | null;
  branch: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  outputKind: string | null;
  outputUrl: string | null;
  errorKind: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type BackgroundRunsResponse = {
  runs: BackgroundRun[];
};

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

export function getBackgroundAgentActionLabels(agent: {
  name: string;
  repoOwner: string;
  repoName: string;
}) {
  const repo = `${agent.repoOwner}/${agent.repoName}`;
  return {
    edit: `Edit background agent ${agent.name}`,
    test: `Test background agent ${agent.name}`,
    repo: `Open agent settings for ${repo}`,
    delete: `Delete background agent ${agent.name}`,
    copyWebhook: `Copy webhook URL for ${agent.name}`,
  };
}

export function getBackgroundRunActionLabels(run: BackgroundRun) {
  const target = `${run.repoOwner}/${run.repoName} ${formatRunTarget(run)}`;
  return {
    output: `Open output for background run ${target}`,
    details: `Open details for background run ${target}`,
  };
}

// Condition field placeholder text by field
const conditionPlaceholders: Record<ConditionField, string> = {
  actions: "opened, reopened",
  branches: "main, release/*",
  labels: "bug, regression",
  environments: "production, preview",
  statuses: "critical, error",
};

// Condition field → FormState key
const conditionFormKey: Record<ConditionField, keyof FormState> = {
  actions: "conditionActions",
  branches: "conditionBranches",
  labels: "conditionLabels",
  environments: "conditionEnvironments",
  statuses: "conditionSeverities",
};

type ConditionFieldsProps = {
  form: FormState;
  triggerKind: TriggerKind;
  onChange: (patch: Partial<FormState>) => void;
};

function ConditionFields({
  form,
  triggerKind,
  onChange,
}: ConditionFieldsProps) {
  const liveFields = fieldsForTrigger(triggerKind);
  if (liveFields.size === 0) {
    return null;
  }

  const fieldOrder: ConditionField[] = [
    "actions",
    "branches",
    "labels",
    "environments",
    "statuses",
  ];

  return (
    <>
      {fieldOrder.flatMap((field) => {
        if (!liveFields.has(field)) return [];
        const formKey = conditionFormKey[field];
        const label = conditionFieldLabel(field, triggerKind);
        const placeholder = conditionPlaceholders[field];
        const value = form[formKey] as string;
        const id = `agent-condition-${field}`;
        return [
          <div key={field} className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange({ [formKey]: event.target.value })}
            />
          </div>,
        ];
      })}
    </>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load background agents");
  }
  return (await response.json()) as T;
}

function formatRunDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRunTarget(run: BackgroundRun) {
  if (run.prNumber !== null) {
    return `PR #${run.prNumber}`;
  }
  if (run.issueNumber !== null) {
    return `Issue #${run.issueNumber}`;
  }
  return run.sha ?? run.ref ?? run.branch ?? run.externalId;
}

function StatusPill({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        normalizedStatus === "enabled" ||
          normalizedStatus === "succeeded" ||
          normalizedStatus === "created"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : normalizedStatus === "failed" || normalizedStatus === "missing"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : normalizedStatus === "queued" || normalizedStatus === "running"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function BackgroundAgentsSection() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<BackgroundAgentsResponse>(
    "/api/background-agents",
    fetchJson,
  );
  const {
    data: runsData,
    error: runsError,
    isLoading: runsLoading,
    mutate: mutateRuns,
  } = useSWR<BackgroundRunsResponse>(
    "/api/background-agent-runs?limit=8",
    fetchJson,
  );
  const {
    data: readinessData,
    error: readinessError,
    isLoading: readinessLoading,
    mutate: mutateReadiness,
  } = useSWR<BackgroundReadinessResponse>(
    "/api/background-agents/readiness",
    fetchJson,
  );
  const [form, setForm] = useState<FormState>(defaultForm);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteConfirmAgentId, setDeleteConfirmAgentId] = useState<
    string | null
  >(null);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const agents = data?.agents ?? [];
  const runs = runsData?.runs ?? [];
  const canSubmit = useMemo(() => isStepValid(form, "test"), [form]);

  const isEditing = editingAgentId !== null;

  function startEditing(agent: BackgroundAgent) {
    setForm(buildFormFromAgent(agent));
    setEditingAgentId(agent.id);
    setMessage(null);
  }

  function cancelEditing() {
    setForm(defaultForm);
    setEditingAgentId(null);
    setMessage(null);
  }

  async function saveAgent() {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        isEditing
          ? `/api/background-agents/${editingAgentId}`
          : "/api/background-agents",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAgentPayload(form)),
        },
      );
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          details?: FlattenedZodDetails;
        };
        const fieldError = firstFieldError(errorBody.details);
        throw new Error(
          fieldError ??
            (isEditing
              ? "Failed to update background agent"
              : "Failed to create background agent"),
        );
      }
      setForm(defaultForm);
      setEditingAgentId(null);
      setMessage(
        isEditing ? "Background agent updated." : "Background agent created.",
      );
      await Promise.all([mutate(), mutateRuns()]);
    } catch (saveError) {
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save background agent",
      );
    } finally {
      setSaving(false);
    }
  }

  async function testAgent(agentId: string) {
    setTestingAgentId(agentId);
    setMessage(null);
    try {
      const response = await fetch(`/api/background-agents/${agentId}/test`, {
        method: "POST",
      });
      const body = (await response.json()) as ManualTestResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to start background agent test");
      }
      const runId = body.runIds[0];
      if (!runId) {
        throw new Error("No background run was created for this test");
      }
      setMessage("Background agent test started.");
      await Promise.all([mutate(), mutateRuns()]);
      router.push(`/background-runs/${runId}`);
    } catch (testError) {
      setMessage(
        testError instanceof Error
          ? testError.message
          : "Failed to start background agent test",
      );
    } finally {
      setTestingAgentId(null);
    }
  }

  async function deleteAgent(agentId: string) {
    setDeletingAgentId(agentId);
    setMessage(null);
    try {
      const response = await fetch(`/api/background-agents/${agentId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete background agent");
      }
      setMessage("Background agent deleted.");
      await mutate();
    } catch (deleteError) {
      setMessage(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete background agent",
      );
    } finally {
      setDeletingAgentId(null);
      setDeleteConfirmAgentId(null);
    }
  }

  async function copyWebhookUrl(webhookPublicId: string) {
    if (typeof window === "undefined") {
      return;
    }
    const url = `${window.location.origin}/api/background-agents/webhook/${webhookPublicId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWebhookId(webhookPublicId);
      window.setTimeout(() => setCopiedWebhookId(null), 1500);
    } catch {
      // clipboard write failed — ignore silently
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Readiness</h2>
        </div>
        {readinessError ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load background agent readiness.
          </div>
        ) : readinessLoading && !readinessData ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading background agent readiness.
          </div>
        ) : readinessData ? (
          <div className="p-4">
            <ReadinessVerdict
              {...mapReadinessToVerdict(readinessData)}
              onRefresh={() => void mutateReadiness()}
              refreshing={readinessLoading}
            />
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-border">
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              {isEditing ? "Edit agent" : "Create agent"}
            </h2>
            {isEditing && (
              <Button variant="ghost" size="sm" onClick={cancelEditing}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {flowSteps.map((step) => (
              <span
                key={step}
                className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground"
              >
                {step}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="agent-trigger">Trigger</Label>
              <Select
                value={form.triggerKind}
                onValueChange={(value) => {
                  const newKind = value as TriggerKind;
                  const liveFields = fieldsForTrigger(newKind);
                  setForm((current) => ({
                    ...current,
                    triggerKind: newKind,
                    // Reset dead condition fields so stale values don't accumulate
                    conditionActions: liveFields.has("actions")
                      ? current.conditionActions
                      : "",
                    conditionBranches: liveFields.has("branches")
                      ? current.conditionBranches
                      : "",
                    conditionLabels: liveFields.has("labels")
                      ? current.conditionLabels
                      : "",
                    conditionEnvironments: liveFields.has("environments")
                      ? current.conditionEnvironments
                      : "",
                    conditionSeverities: liveFields.has("statuses")
                      ? current.conditionSeverities
                      : "",
                    // Reset schedule when switching away from cron
                    schedule:
                      newKind === "schedule.cron" ? current.schedule : "",
                  }));
                }}
              >
                <SelectTrigger id="agent-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(triggerLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) =>
                  setForm((current) => ({ ...current, enabled }))
                }
                aria-label="Enable background agent"
              />
              <span className="text-xs text-muted-foreground">Enabled</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-owner">Owner</Label>
            <Input
              id="repo-owner"
              value={form.repoOwner}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  repoOwner: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-name">Repo</Label>
            <Input
              id="repo-name"
              value={form.repoName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  repoName: event.target.value,
                }))
              }
            />
          </div>
          {form.triggerKind === "schedule.cron" && (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="agent-schedule">Schedule</Label>
              <Input
                id="agent-schedule"
                value={form.schedule}
                placeholder="@hourly"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    schedule: event.target.value,
                  }))
                }
              />
            </div>
          )}
          <ConditionFields
            form={form}
            triggerKind={form.triggerKind}
            onChange={(patch) =>
              setForm((current) => ({ ...current, ...patch }))
            }
          />
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              className="min-h-28"
              value={form.instructions}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="agent-output">Output mode</Label>
            <Select
              value={form.outputMode}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  outputMode: value as OutputMode,
                }))
              }
            >
              <SelectTrigger id="agent-output">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedOutputModes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {outputModeLabel(mode)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {describeOutputModePermissions(form.outputMode)}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-check">Check command</Label>
            <Input
              id="agent-check"
              value={form.checkCommand}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  checkCommand: event.target.value,
                }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4 md:col-span-2">
            <p className="text-xs text-muted-foreground">
              Tool providers coming later. Composio is planned for v1.5.
            </p>
            <Button disabled={!canSubmit || saving} onClick={saveAgent}>
              {isEditing ? (
                <Save className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isEditing ? "Save" : "Create"}
            </Button>
          </div>
          {message && (
            <p className="text-xs text-muted-foreground md:col-span-2">
              {message}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Agents</h2>
          <Button
            aria-label="Refresh background agents"
            variant="ghost"
            size="icon"
            onClick={() => void mutate()}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
        {error ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load background agents.
          </div>
        ) : isLoading && !data ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading background agents.
          </div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No background agents yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                copiedWebhookId={copiedWebhookId}
                deleteConfirmAgentId={deleteConfirmAgentId}
                deletingAgentId={deletingAgentId}
                testingAgentId={testingAgentId}
                onCopyWebhook={copyWebhookUrl}
                onDelete={deleteAgent}
                onEdit={startEditing}
                onSetDeleteConfirmAgentId={setDeleteConfirmAgentId}
                onTest={testAgent}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-md border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Run history</h2>
          <Button
            aria-label="Refresh background runs"
            variant="ghost"
            size="icon"
            onClick={() => void mutateRuns()}
          >
            <RefreshCw
              className={cn("h-4 w-4", runsLoading && "animate-spin")}
            />
          </Button>
        </div>
        {runsError ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load background runs.
          </div>
        ) : runsLoading && !runsData ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading background runs.
          </div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No background runs yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentRow({
  agent,
  copiedWebhookId,
  deleteConfirmAgentId,
  deletingAgentId,
  testingAgentId,
  onCopyWebhook,
  onDelete,
  onEdit,
  onSetDeleteConfirmAgentId,
  onTest,
}: {
  agent: BackgroundAgent;
  copiedWebhookId: string | null;
  deleteConfirmAgentId: string | null;
  deletingAgentId: string | null;
  testingAgentId: string | null;
  onCopyWebhook: (webhookPublicId: string) => void | Promise<void>;
  onDelete: (agentId: string) => void | Promise<void>;
  onEdit: (agent: BackgroundAgent) => void;
  onSetDeleteConfirmAgentId: (agentId: string | null) => void;
  onTest: (agentId: string) => void | Promise<void>;
}) {
  const labels = getBackgroundAgentActionLabels(agent);

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="truncate text-sm font-medium">{agent.name}</p>
          <StatusPill status={agent.status} />
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {agent.repoOwner}/{agent.repoName}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agent.triggers.map((trigger) => (
            <span
              key={trigger.id}
              className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {triggerLabels[trigger.kind]}
            </span>
          ))}
        </div>
        {agent.triggers.map((trigger) =>
          trigger.kind === "webhook.error" && trigger.webhookPublicId ? (
            <div
              key={`webhook-url-${trigger.id}`}
              className="mt-2 flex items-center gap-1.5"
            >
              <Input
                readOnly
                value={`/api/background-agents/webhook/${trigger.webhookPublicId}`}
                className="h-6 font-mono text-[10px]"
                aria-label={`Webhook URL for ${agent.name}`}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label={labels.copyWebhook}
                onClick={() =>
                  void onCopyWebhook(trigger.webhookPublicId ?? "")
                }
              >
                {copiedWebhookId === trigger.webhookPublicId ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <ClipboardCopy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.edit}
          onClick={() => onEdit(agent)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.test}
          disabled={testingAgentId === agent.id}
          onClick={() => void onTest(agent.id)}
        >
          <Play className="h-3.5 w-3.5" />
          Test
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/repos/${agent.repoOwner}/${agent.repoName}/agents`}
            aria-label={labels.repo}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Repo
          </Link>
        </Button>
        <Button
          variant="destructive"
          size="sm"
          aria-label={labels.delete}
          disabled={deletingAgentId === agent.id}
          onClick={() => onSetDeleteConfirmAgentId(agent.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Dialog
          open={deleteConfirmAgentId === agent.id}
          onOpenChange={(open) => {
            if (!open) {
              onSetDeleteConfirmAgentId(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete agent</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{agent.name}</strong>?
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={deletingAgentId === agent.id}
                onClick={() => void onDelete(agent.id)}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: BackgroundRun }) {
  const labels = getBackgroundRunActionLabels(run);

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">
            {triggerLabels[run.triggerKind as TriggerKind] ?? run.triggerKind}
          </p>
          <StatusPill status={run.status} />
          {run.errorKind && (
            <span className="rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-700 dark:text-red-300">
              {run.errorKind}
            </span>
          )}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {run.repoOwner}/{run.repoName} · {formatRunTarget(run)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {run.source} · {formatRunDate(run.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {run.outputUrl && (
          <Button asChild variant="outline" size="sm">
            <Link href={run.outputUrl} aria-label={labels.output}>
              <ExternalLink className="h-3.5 w-3.5" />
              Output
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={`/background-runs/${run.id}`} aria-label={labels.details}>
            <ExternalLink className="h-3.5 w-3.5" />
            Details
          </Link>
        </Button>
      </div>
    </div>
  );
}
