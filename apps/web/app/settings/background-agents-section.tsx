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
import { Button, buttonVariants } from "@/components/ui/button";
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
import { GitHubActionsSection } from "@/app/repos/[owner]/[repo]/agents/github-actions-section";
import {
  buildAgentPayload,
  buildFormFromAgent,
  conditionFieldLabel,
  defaultForm,
  describeEnabledActions,
  fieldsForTrigger,
  isStepValid,
  triggerLabels,
  type BackgroundAgent,
  type ConditionField,
  type FormState,
  type GitHubToolAction,
  type StepId,
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

const stepOrder: StepId[] = [
  "trigger",
  "conditions",
  "instructions",
  "permissions",
  "outputs",
  "test",
];

const stepLabels: Record<StepId, string> = {
  trigger: "Trigger",
  conditions: "Conditions",
  instructions: "Instructions",
  permissions: "Permissions",
  outputs: "Output",
  test: "Review",
};

export function readinessBlockReason(
  readinessData: BackgroundReadinessResponse | undefined,
) {
  if (!readinessData) {
    return null;
  }
  if (readinessData.ready && readinessData.enabled) {
    return null;
  }
  if (!readinessData.enabled) {
    return "Background agents are disabled for this deployment.";
  }
  const count = readinessData.missing.length;
  return `${count} background agent setup ${count === 1 ? "step" : "steps"} must be completed first.`;
}

type ConditionFieldsProps = {
  form: FormState;
  triggerKind: TriggerKind;
  onChange: (patch: Partial<FormState>) => void;
};

export function ConditionFields({
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

export function PermissionsSummary({
  enabledActions,
}: {
  enabledActions: GitHubToolAction[];
}) {
  const requiresWrite = enabledActions.length > 0;
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Permissions summary</p>
          <p className="text-pretty text-xs text-muted-foreground">
            {describeEnabledActions(enabledActions)}
          </p>
        </div>
        <StatusPill status={requiresWrite ? "write access" : "read-only"} />
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded border border-border bg-background px-2 py-1.5">
          <span className="text-muted-foreground">GitHub contents: </span>
          <span className="font-medium">
            {requiresWrite ? "write" : "read"}
          </span>
        </div>
        <div className="rounded border border-border bg-background px-2 py-1.5">
          <span className="text-muted-foreground">Pull requests: </span>
          <span className="font-medium">
            {requiresWrite ? "write" : "read"}
          </span>
        </div>
      </div>
    </div>
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
  const [activeStep, setActiveStep] = useState<StepId>("trigger");

  const agents = data?.agents ?? [];
  const runs = runsData?.runs ?? [];
  const canSubmit = useMemo(() => isStepValid(form, "test"), [form]);
  const readinessReason = readinessBlockReason(readinessData);
  const canSave = canSubmit && !readinessReason;

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
    setActiveStep("trigger");
  }

  async function saveAgent() {
    if (!canSave) {
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
      setActiveStep("trigger");
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
    setMessage("Starting background agent test...");
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
      setMessage("Background agent test started. Opening run details...");
      router.push(`/background-runs/${runId}`);
      void Promise.all([mutate(), mutateRuns()]).catch(() => undefined);
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
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Background agent setup steps"
          >
            {stepOrder.map((step, index) => {
              const valid = isStepValid(form, step);
              return (
                <button
                  key={step}
                  type="button"
                  role="tab"
                  aria-selected={activeStep === step}
                  onClick={() => setActiveStep(step)}
                  className={cn(
                    "rounded border px-2 py-1 text-[10px] font-medium transition-colors",
                    activeStep === step
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {index + 1}. {stepLabels[step]}
                  {!valid && <span className="sr-only"> incomplete</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-4">
          <div
            role="tabpanel"
            hidden={activeStep !== "trigger"}
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="space-y-2">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
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
          </div>

          <div
            role="tabpanel"
            hidden={activeStep !== "conditions"}
            className="grid gap-4 md:grid-cols-2"
          >
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
            {fieldsForTrigger(form.triggerKind).size === 0 &&
              form.triggerKind !== "schedule.cron" && (
                <p className="text-sm text-muted-foreground md:col-span-2">
                  This trigger does not need condition fields.
                </p>
              )}
          </div>

          <div
            role="tabpanel"
            hidden={activeStep !== "instructions"}
            className="space-y-2"
          >
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              className="min-h-28"
              value={form.instructions}
              placeholder="Review this PR for regressions and comment findings."
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))
              }
            />
          </div>

          <div
            role="tabpanel"
            hidden={activeStep !== "permissions"}
            className="space-y-4"
          >
            <PermissionsSummary enabledActions={form.enabledActions ?? []} />
            <p className="text-xs text-muted-foreground">
              Permissions are derived from the GitHub actions enabled below so
              the agent only gets the access needed to perform them.
            </p>
          </div>

          <div
            role="tabpanel"
            hidden={activeStep !== "outputs"}
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="space-y-2 md:col-span-2">
              <GitHubActionsSection
                enabledActions={form.enabledActions ?? []}
                onChange={(next) =>
                  setForm((current) => ({ ...current, enabledActions: next }))
                }
                requireCiGreenToMerge={form.requireCiGreenToMerge ?? true}
                onRequireCiGreenChange={(next) =>
                  setForm((current) => ({
                    ...current,
                    requireCiGreenToMerge: next,
                  }))
                }
              />
              <PermissionsSummary enabledActions={form.enabledActions ?? []} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="agent-check">Check command</Label>
              <Input
                id="agent-check"
                value={form.checkCommand}
                placeholder="bun --bun run ci"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    checkCommand: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div
            role="tabpanel"
            hidden={activeStep !== "test"}
            className="space-y-4"
          >
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <p className="font-medium">
                {canSubmit
                  ? "Ready to save this background agent."
                  : "Finish the required setup fields before saving."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {form.enabled
                  ? "It will run when its trigger fires."
                  : "It will be saved disabled so you can test before turning it on."}
              </p>
              {readinessReason && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {readinessReason}
                </p>
              )}
            </div>
            <PermissionsSummary enabledActions={form.enabledActions ?? []} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Composio tools are supported for connected toolkit slugs; use the
              repo-scoped builder to add external tools to an agent.
            </p>
            <Button
              disabled={!canSave || saving}
              type="button"
              onClick={saveAgent}
              title={readinessReason ?? undefined}
            >
              {isEditing ? (
                <Save className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isEditing ? "Save" : "Create"}
            </Button>
          </div>
          {message && (
            <p className="mt-3 text-xs text-muted-foreground">{message}</p>
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
            type="button"
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
              <div
                key={agent.id}
                className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]"
              >
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
                    trigger.kind === "webhook.error" &&
                    trigger.webhookPublicId ? (
                      <div
                        key={`webhook-url-${trigger.id}`}
                        className="mt-2 flex items-center gap-1.5"
                      >
                        <Input
                          readOnly
                          value={`/api/background-agents/webhook/${trigger.webhookPublicId}`}
                          className="h-6 font-mono text-[10px]"
                          aria-label="Webhook URL"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          className="h-6 w-6 shrink-0"
                          aria-label="Copy webhook URL"
                          onClick={() =>
                            void copyWebhookUrl(trigger.webhookPublicId ?? "")
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
                    type="button"
                    onClick={() => startEditing(agent)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={
                      testingAgentId === agent.id || Boolean(readinessReason)
                    }
                    title={readinessReason ?? undefined}
                    onClick={() => void testAgent(agent.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Test
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/repos/${agent.repoOwner}/${agent.repoName}/agents`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Repo
                    </Link>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    aria-label="Delete agent"
                    disabled={deletingAgentId === agent.id}
                    onClick={() => setDeleteConfirmAgentId(agent.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <Dialog
                    open={deleteConfirmAgentId === agent.id}
                    onOpenChange={(open) => {
                      if (!open) {
                        setDeleteConfirmAgentId(null);
                      }
                    }}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete agent</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to delete{" "}
                          <strong>{agent.name}</strong>? This action cannot be
                          undone.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="outline">
                            Cancel
                          </Button>
                        </DialogClose>
                        <Button
                          variant="destructive"
                          type="button"
                          disabled={deletingAgentId === agent.id}
                          onClick={() => void deleteAgent(agent.id)}
                        >
                          Delete
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
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
            type="button"
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
              <div
                key={run.id}
                className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {triggerLabels[run.triggerKind as TriggerKind] ??
                        run.triggerKind}
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
                      <Link href={run.outputUrl}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Output
                      </Link>
                    </Button>
                  )}
                  <Link
                    aria-label={`Open details for background run ${run.repoOwner}/${run.repoName} ${formatRunTarget(run)}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                    href={`/background-runs/${run.id}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
