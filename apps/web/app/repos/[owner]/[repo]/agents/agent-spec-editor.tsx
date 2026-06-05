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
  type OutputMode,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import { validateSchedule } from "@/lib/background-agents/schedule-presets";
import { SchedulePreview, ScheduleValidationMessage } from "./schedule-preview";
import { EventTriggerConditions } from "./event-trigger-conditions";

type AgentSpecEditorProps = {
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
 */
export function AgentSpecEditor({
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

  const showWritePermissionsNote = outputMode === "ready_pr";

  return (
    <div className="space-y-6">
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
          <div className="space-y-2">
            <Label htmlFor="spec-schedule">Schedule (cron)</Label>
            <Input
              id="spec-schedule"
              value={schedule}
              placeholder="@hourly"
              onChange={(e) => setSchedule(e.target.value)}
            />
            <ScheduleValidationMessage schedule={schedule} />
            <SchedulePreview schedule={schedule} fromDate={new Date()} />
          </div>
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
          <Select
            value={outputMode}
            onValueChange={(v) => setOutputMode(v as OutputMode)}
          >
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

      {/* Permissions section */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Permissions</h3>
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-1">
          <p className="font-medium">GitHub App permissions</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              <span className="font-mono">contents</span>:{" "}
              {showWritePermissionsNote ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  write
                </span>
              ) : (
                "read"
              )}
            </li>
            <li>
              <span className="font-mono">pull_requests</span>:{" "}
              {showWritePermissionsNote ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  write
                </span>
              ) : (
                "read"
              )}
            </li>
            <li>
              <span className="font-mono">issues</span>: read
            </li>
            <li>
              <span className="font-mono">deployments</span>: read
            </li>
            <li>
              <span className="font-mono">checks</span>: read
            </li>
          </ul>
          {showWritePermissionsNote && (
            <div className="mt-2 flex items-start gap-2 rounded border border-amber-500/25 bg-amber-50/30 p-2 dark:bg-amber-950/20">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-amber-700 dark:text-amber-400">
                Ready PR output requires <strong>write</strong> access to
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
                New agents are created disabled. Enable after reviewing the
                spec.
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

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={!canSave || saving} onClick={handleSave}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button variant="outline" disabled={running} onClick={handleRunTest}>
          <Play className="h-4 w-4" />
          Run test
        </Button>
        <p className="text-xs text-muted-foreground">
          {enabled
            ? "Agent will be created enabled."
            : "Agent will be created disabled (default)."}
        </p>
      </div>
    </div>
  );
}
