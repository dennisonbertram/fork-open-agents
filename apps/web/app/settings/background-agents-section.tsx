"use client";

import { Bot, ExternalLink, Play, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
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

type TriggerKind =
  | "github.pull_request"
  | "github.deployment_status"
  | "github.issue"
  | "schedule.cron"
  | "webhook.error";

type OutputMode = "comment" | "ready_pr" | "issue" | "notification" | "none";

type BackgroundAgentTrigger = {
  id: string;
  name: string;
  kind: TriggerKind;
  status: "enabled" | "disabled";
  schedule: string | null;
  webhookPublicId: string | null;
};

type BackgroundAgent = {
  id: string;
  name: string;
  description: string | null;
  status: "enabled" | "disabled";
  repoOwner: string;
  repoName: string;
  instructions: string;
  outputMode: OutputMode;
  checkCommand: string | null;
  triggers: BackgroundAgentTrigger[];
};

type BackgroundAgentsResponse = {
  agents: BackgroundAgent[];
};

type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  error?: string;
};

type FormState = {
  name: string;
  repoOwner: string;
  repoName: string;
  triggerKind: TriggerKind;
  schedule: string;
  instructions: string;
  outputMode: OutputMode;
  checkCommand: string;
  enabled: boolean;
};

const defaultForm: FormState = {
  name: "",
  repoOwner: "",
  repoName: "",
  triggerKind: "github.pull_request",
  schedule: "",
  instructions: "",
  outputMode: "none",
  checkCommand: "",
  enabled: false,
};

const triggerLabels: Record<TriggerKind, string> = {
  "github.pull_request": "Pull request",
  "github.deployment_status": "Deployment status",
  "github.issue": "Issue",
  "schedule.cron": "Schedule",
  "webhook.error": "Error webhook",
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load background agents");
  }
  return (await response.json()) as T;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "enabled"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function buildCreatePayload(form: FormState) {
  return {
    name: form.name,
    repoOwner: form.repoOwner,
    repoName: form.repoName,
    status: form.enabled ? "enabled" : "disabled",
    instructions: form.instructions,
    outputMode: form.outputMode,
    checkCommand: form.checkCommand || null,
    permissions: {
      github: {
        contents: form.outputMode === "ready_pr" ? "write" : "read",
        pullRequests: form.outputMode === "ready_pr" ? "write" : "read",
        issues: "read",
        deployments: "read",
        statuses: "read",
        checks: "read",
      },
    },
    triggers: [
      {
        name: triggerLabels[form.triggerKind],
        kind: form.triggerKind,
        status: "enabled",
        conditions: {},
        schedule: form.triggerKind === "schedule.cron" ? form.schedule : null,
      },
    ],
  };
}

export function BackgroundAgentsSection() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<BackgroundAgentsResponse>(
    "/api/background-agents",
    fetchJson,
  );
  const [form, setForm] = useState<FormState>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const agents = data?.agents ?? [];
  const canSubmit = useMemo(
    () =>
      form.name.trim() &&
      form.repoOwner.trim() &&
      form.repoName.trim() &&
      form.instructions.trim(),
    [form],
  );

  async function createAgent() {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCreatePayload(form)),
      });
      if (!response.ok) {
        throw new Error("Failed to create background agent");
      }
      setForm(defaultForm);
      setMessage("Background agent created.");
      await mutate();
    } catch (createError) {
      setMessage(
        createError instanceof Error
          ? createError.message
          : "Failed to create background agent",
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
      await mutate();
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

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Create agent</h2>
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
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    triggerKind: value as TriggerKind,
                  }))
                }
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
          <div className="space-y-2">
            <Label htmlFor="agent-output">Output</Label>
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
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="comment">Comment</SelectItem>
                <SelectItem value="ready_pr">Ready PR</SelectItem>
                <SelectItem value="issue">Issue</SelectItem>
                <SelectItem value="notification">Notification</SelectItem>
              </SelectContent>
            </Select>
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
            <Button disabled={!canSubmit || saving} onClick={createAgent}>
              <Plus className="h-4 w-4" />
              Create
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
          <Button variant="ghost" size="icon" onClick={() => void mutate()}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
        {error ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load background agents.
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
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testingAgentId === agent.id}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
