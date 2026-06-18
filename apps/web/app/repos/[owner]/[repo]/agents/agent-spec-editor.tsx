"use client";

import { AlertCircle, ChevronDown, Play, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/components/ui/settings-section";
import { cn } from "@/lib/utils";
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
  /** The ID of the agent once saved — enables the Run a test button. Defaults to null (disabled). */
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
 * - Repo owner/name are shown in the breadcrumb, NOT as a field here.
 * - Agent starts disabled by default.
 * - No auto-merge controls (v1 autonomy = draft PR / report only).
 * - ready_pr output makes GitHub write/PR permissions explicit.
 * - schedule.cron trigger mounts the schedule components visibly.
 * - Actions (Save + Run a test) are at the TOP of the editor.
 * - Tools section keeps existing permission selects (contents + pull_requests).
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
  // Merge goal into instructions once, as the initial value: prepend the goal as
  // the first sentence when present. Computed in a lazy useState initializer so
  // later edits live entirely in `instructions` state (no deps to track).
  const [instructions, setInstructions] = useState(() => {
    if (!initialGoal) return initialInstructions;
    if (initialInstructions.startsWith(initialGoal)) return initialInstructions;
    return `${initialGoal}\n\n${initialInstructions}`.trim();
  });
  const [outputMode, setOutputMode] = useState<OutputMode>(initialOutputMode);
  const [checkCommand, setCheckCommand] = useState(initialCheckCommand);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState(false);
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
      {/* Actions + Enable — at TOP */}
      <div className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canSave || saving} onClick={handleSave}>
              <Save className="h-4 w-4" />
              Save
            </Button>
            <span
              title={!createdAgentId ? "Save first to run a test." : undefined}
            >
              <Button
                variant="outline"
                disabled={runTestDisabled}
                onClick={handleRunTest}
              >
                <Play className="h-4 w-4" />
                Run a test
              </Button>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Enable
            </span>
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-0.5">
              <button
                type="button"
                onClick={() => setEnabled(true)}
                aria-pressed={enabled}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  enabled
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Enabled
              </button>
              <button
                type="button"
                onClick={() => setEnabled(false)}
                aria-pressed={!enabled}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  enabled
                    ? "text-muted-foreground hover:text-foreground"
                    : "bg-background text-foreground shadow-sm",
                )}
              >
                Disabled
              </button>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {!createdAgentId
            ? "Save first to run a test."
            : mode === "edit"
              ? enabled
                ? "This agent is on — it runs when its trigger fires."
                : "This agent is off — it won't run until you turn it on."
              : enabled
                ? "This agent will be created on."
                : "New agents start off — test it, then turn it on here."}
        </p>
      </div>

      {/* Inline run test console — mounts below action bar when a test run is active */}
      {testRunId && <RunTestConsole runId={testRunId} />}

      {/* 1 — Name */}
      <SettingsSection
        title="Name"
        description="A short name you'll recognize in the agents list."
      >
        <Input
          id="spec-name"
          aria-label="Agent name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. PR Backlog Maintainer"
        />
      </SettingsSection>

      {/* 2 — What should this agent do? (merged goal + instructions) */}
      <SettingsSection
        title="What should this agent do?"
        description="Describe the job in plain language — what to look at, what to do, and what to leave alone."
      >
        <div className="space-y-2">
          <Textarea
            id="spec-instructions"
            className="min-h-32"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="When a pull request is opened, review the diff and add a brief summary comment. Don't approve or merge."
          />
        </div>
      </SettingsSection>

      {/* 3 — When should it run? */}
      <SettingsSection
        title="When should it run?"
        description="Pick what wakes this agent up."
      >
        <div className="space-y-3">
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
          {triggerKind === "schedule.cron" && (
            <SchedulePicker schedule={schedule} onChange={setSchedule} />
          )}
          {/* "Refine when it runs" disclosure — keeps children in DOM (CSS hidden)
              so EventTriggerConditions labels stay in SSR markup for tests. */}
          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setConditionsOpen((v) => !v)}
              aria-expanded={conditionsOpen}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  conditionsOpen && "rotate-180",
                )}
              />
              Refine when it runs
            </button>
            {/* Always render children — use CSS visibility so labels remain in markup */}
            <div className={cn("mt-3", conditionsOpen ? "" : "hidden")}>
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
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* 4 — Tools (Phase 2 note: keep existing permission selects as-is, renamed heading) */}
      <SettingsSection
        title="Tools"
        description="The apps and abilities this agent can use."
      >
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
      </SettingsSection>

      {/* 5 — Result (output mode) */}
      <SettingsSection
        title="Result"
        description="Choose what the agent leaves behind after a run."
        advanced={{
          label: "Advanced",
          children: (
            <div className="space-y-2">
              <Label htmlFor="spec-check">
                Verification command (optional)
              </Label>
              <Input
                id="spec-check"
                value={checkCommand}
                onChange={(e) => setCheckCommand(e.target.value)}
                placeholder="bun --bun run ci"
              />
              <p className="text-xs text-muted-foreground">
                A shell command the agent runs to prove its change works before
                opening a pull request — for example{" "}
                <code className="font-mono">bun --bun run ci</code>. Leave blank
                to skip.
              </p>
            </div>
          ),
        }}
      >
        <div className="space-y-2">
          {supportedOutputModes.map((m) => {
            const isReadyPr = m === "ready_pr";
            const isDisabled =
              isReadyPr &&
              permissionPullRequests === "read" &&
              permissionContents === "read";
            return (
              <label
                key={m}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                  outputMode === m
                    ? "border-primary bg-primary/5"
                    : "border-border"
                } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="radio"
                  name="output-mode"
                  value={m}
                  checked={outputMode === m}
                  disabled={isDisabled}
                  onChange={() => handleOutputModeChange(m)}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium">
                    {m === "ready_pr" ? "Open a pull request" : "Report only"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m === "ready_pr"
                      ? "Open a draft pull request with its changes for you to review and merge."
                      : "Leave a written summary on the run — you'll find it in this agent's run history. Doesn't open a PR or change the repo."}
                  </p>
                  {isDisabled && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      Give the GitHub tool pull-request access to use this.
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
