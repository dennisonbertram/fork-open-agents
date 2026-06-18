"use client";

import { AlertCircle, Play, Save } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  buildAgentPayload,
  supportedOutputModes,
  triggerLabels,
  type FormState,
  type GitHubAccessLevel,
  type OutputMode,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import { validateSchedule } from "@/lib/background-agents/schedule-presets";
import { SchedulePicker } from "./schedule-picker";
import { EventTriggerConditions } from "./event-trigger-conditions";
import { RunTestConsole } from "./run-test-console";

type AgentSpecEditorProps = {
  /** "create" (default) shows creation-oriented copy; "edit" shows update-oriented copy. */
  mode?: "create" | "edit";
  repoOwner: string;
  repoName: string;
  initialName: string;
  initialGoal: string;
  initialTriggerKind: TriggerKind;
  initialInstructions: string;
  initialOutputMode: OutputMode;
  initialCheckCommand: string;
  initialEnabled: boolean;
  initialSchedule?: string;
  initialConditionActions?: string;
  initialConditionBranches?: string;
  initialConditionLabels?: string;
  initialConditionEnvironments?: string;
  initialConditionSeverities?: string;
  initialPermissionContents?: GitHubAccessLevel;
  initialPermissionPullRequests?: GitHubAccessLevel;
  /** The ID of the agent once saved — enables the Run test button. Defaults to null (disabled). */
  createdAgentId?: string | null;
  /** The run ID to show inline console for, or null if no test has been run yet. */
  testRunId?: string | null;
  onSave: (
    payload: ReturnType<typeof buildAgentPayload>,
  ) => void | Promise<void>;
  onRunTest: () => void | Promise<void>;
};

/**
 * Reviewed/editable spec form for creating a GitHub project agent.
 *
 * - Repo owner/name are displayed but NOT editable (fixed by route params).
 * - Agent starts disabled by default.
 * - No auto-merge controls (v1 autonomy = draft PR / report only).
 * - ready_pr output makes GitHub write/PR permissions explicit.
 * - schedule.cron trigger mounts the schedule components from slice #164.
 * - Actions (Save + Run test) are at the TOP of the editor (decision C).
 * - Permissions section has interactive Select controls for contents + pull_requests (decision E).
 */
export function AgentSpecEditor({
  mode = "create",
  repoOwner,
  repoName,
  initialName,
  initialGoal,
  initialTriggerKind,
  initialInstructions,
  initialOutputMode,
  initialCheckCommand,
  initialEnabled,
  initialSchedule = "",
  initialConditionActions = "",
  initialConditionBranches = "",
  initialConditionLabels = "",
  initialConditionEnvironments = "",
  initialConditionSeverities = "",
  initialPermissionContents = "read",
  initialPermissionPullRequests = "read",
  createdAgentId = null,
  testRunId = null,
  onSave,
  onRunTest,
}: AgentSpecEditorProps) {
  const [name, setName] = useState(initialName);
  const [triggerKind, setTriggerKind] =
    useState<TriggerKind>(initialTriggerKind);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [conditionActions, setConditionActions] = useState(
    initialConditionActions,
  );
  const [conditionBranches, setConditionBranches] = useState(
    initialConditionBranches,
  );
  const [conditionLabels, setConditionLabels] = useState(
    initialConditionLabels,
  );
  const [conditionEnvironments, setConditionEnvironments] = useState(
    initialConditionEnvironments,
  );
  const [conditionSeverities, setConditionSeverities] = useState(
    initialConditionSeverities,
  );
  const [instructions, setInstructions] = useState(initialInstructions);
  const [outputMode, setOutputMode] = useState<OutputMode>(initialOutputMode);
  const [checkCommand, setCheckCommand] = useState(initialCheckCommand);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [permissionContents, setPermissionContents] =
    useState<GitHubAccessLevel>(initialPermissionContents);
  const [permissionPullRequests, setPermissionPullRequests] =
    useState<GitHubAccessLevel>(initialPermissionPullRequests);

  const isScheduleValid = useMemo(() => {
    if (triggerKind !== "schedule.cron") return true;
    return validateSchedule(schedule).valid;
  }, [triggerKind, schedule]);

  const canSave = useMemo(
    () =>
      name.trim().length > 0 &&
      instructions.trim().length > 0 &&
      isScheduleValid,
    [name, instructions, isScheduleValid],
  );

  function buildCurrentPayload() {
    const form: FormState = {
      name,
      repoOwner,
      repoName,
      triggerKind,
      schedule,
      conditionActions,
      conditionBranches,
      conditionLabels,
      conditionEnvironments,
      conditionSeverities,
      instructions,
      outputMode,
      checkCommand,
      enabled,
      permissionContents,
      permissionPullRequests,
    };
    return buildAgentPayload(form);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(buildCurrentPayload());
    } finally {
      setSaving(false);
    }
  }

  async function handleRunTest() {
    setRunning(true);
    try {
      await onRunTest();
    } finally {
      setRunning(false);
    }
  }

  function handleOutputModeChange(v: string) {
    const newMode = v as OutputMode;
    setOutputMode(newMode);
    // Auto-coerce permissions to write when transitioning to ready_pr.
    // Only on the transition (handler), not an effect — so user can override
    // back to read after the initial coerce without losing their choice.
    if (newMode === "ready_pr") {
      setPermissionContents("write");
      setPermissionPullRequests("write");
    }
  }

  const runTestDisabled = running || !createdAgentId;

  return (
    <div className="space-y-6">
      {/* Actions — moved to TOP per decision C */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <Button disabled={!canSave || saving} onClick={handleSave}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <span
          title={
            !createdAgentId ? "Save the agent before running a test" : undefined
          }
        >
          <Button
            variant="outline"
            disabled={runTestDisabled}
            onClick={handleRunTest}
          >
            <Play className="h-4 w-4" />
            Run test
          </Button>
        </span>
        <p className="text-xs text-muted-foreground">
          {!createdAgentId
            ? "Save the agent before running a test"
            : mode === "edit"
              ? enabled
                ? "Agent is enabled — will run when its trigger fires."
                : "Agent is disabled — will not run until enabled."
              : enabled
                ? "Agent will be created enabled."
                : "Agent will be created disabled (default)."}
        </p>
      </div>

      {/* Inline run test console — mounts below action bar when a test run is active */}
      {testRunId && <RunTestConsole runId={testRunId} />}

      {/* Purpose section */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Purpose</h3>
        <div className="rounded-md border border-border bg-muted/10 px-3 py-2 font-mono text-xs text-muted-foreground">
          {repoOwner}/{repoName}
        </div>
        {initialGoal && (
          <p className="text-xs text-muted-foreground">{initialGoal}</p>
        )}
        <div className="space-y-2">
          <Label htmlFor="spec-name">Agent name</Label>
          <Input
            id="spec-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PR Backlog Maintainer"
          />
        </div>
      </section>

      {/* Trigger section */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Trigger</h3>
        <div className="space-y-2">
          <Label htmlFor="spec-trigger">Trigger kind</Label>
          <Select
            value={triggerKind}
            onValueChange={(v) => setTriggerKind(v as TriggerKind)}
          >
            <SelectTrigger id="spec-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(triggerLabels) as [TriggerKind, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {triggerKind === "schedule.cron" && (
          <SchedulePicker schedule={schedule} onChange={setSchedule} />
        )}
        <EventTriggerConditions
          triggerKind={triggerKind}
          conditionActions={conditionActions}
          conditionBranches={conditionBranches}
          conditionLabels={conditionLabels}
          conditionEnvironments={conditionEnvironments}
          conditionSeverities={conditionSeverities}
          onConditionActionsChange={setConditionActions}
          onConditionBranchesChange={setConditionBranches}
          onConditionLabelsChange={setConditionLabels}
          onConditionEnvironmentsChange={setConditionEnvironments}
          onConditionSeveritiesChange={setConditionSeverities}
        />
      </section>

      {/* Instructions section */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Instructions</h3>
        <div className="space-y-2">
          <Label htmlFor="spec-instructions">What should this agent do?</Label>
          <Textarea
            id="spec-instructions"
            className="min-h-32"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Describe the agent's behavior in plain language…"
          />
        </div>
      </section>

      {/* Output section */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Output</h3>
        <div className="space-y-2">
          <Label htmlFor="spec-output">Output mode</Label>
          <Select value={outputMode} onValueChange={handleOutputModeChange}>
            <SelectTrigger id="spec-output">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedOutputModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode === "ready_pr"
                    ? "Ready PR"
                    : "None (comment / report only)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="spec-check">Check command (optional)</Label>
          <Input
            id="spec-check"
            value={checkCommand}
            onChange={(e) => setCheckCommand(e.target.value)}
            placeholder="bun --bun run ci"
          />
        </div>
      </section>

      {/* Permissions section — interactive selects for contents + pull_requests (decision E) */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Permissions</h3>
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-3">
          <p className="font-medium">GitHub App permissions</p>

          {/* Interactive: contents */}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-muted-foreground">contents</span>
            <Select
              value={permissionContents}
              onValueChange={(v) =>
                setPermissionContents(v as GitHubAccessLevel)
              }
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">read</SelectItem>
                <SelectItem value="write">write</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Interactive: pull_requests */}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-muted-foreground">
              pull_requests
            </span>
            <Select
              value={permissionPullRequests}
              onValueChange={(v) =>
                setPermissionPullRequests(v as GitHubAccessLevel)
              }
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">read</SelectItem>
                <SelectItem value="write">write</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Static: issues / deployments / checks */}
          <div className="space-y-0.5 text-muted-foreground border-t border-border pt-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono">issues</span>
              <span className="text-xs">read</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono">deployments</span>
              <span className="text-xs">read</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono">checks</span>
              <span className="text-xs">read</span>
            </div>
          </div>

          {outputMode === "ready_pr" && (
            <div className="mt-2 flex items-start gap-2 rounded border border-amber-500/25 bg-amber-50/30 p-2 dark:bg-amber-950/20">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-amber-700 dark:text-amber-400">
                Ready PR output works best with <strong>write</strong> access to
                contents and pull requests so the agent can push a branch and
                open a PR.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Safety / autonomy section — no auto-merge in v1 */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Safety / autonomy</h3>
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Enabled</p>
              <p className="text-muted-foreground">
                {mode === "edit"
                  ? "Controls whether this agent runs when its trigger fires."
                  : "New agents are created disabled. Enable after reviewing the spec."}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <p className="text-muted-foreground border-t border-border pt-2">
            Autonomy level: <strong>draft PR / report only</strong>. Merge
            decisions always require human review. Autonomous merge is not
            supported in v1.
          </p>
        </div>
      </section>
    </div>
  );
}
