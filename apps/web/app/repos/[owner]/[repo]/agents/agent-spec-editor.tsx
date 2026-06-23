"use client";

import { ArrowRight, ChevronDown, Play, Save } from "lucide-react";
import Link from "next/link";
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
import {
  GitHubToolCard,
  permissionsToAccess,
  type GitHubToolAccess,
} from "./github-tool-card";
import { ComposioOtherToolsSection } from "./composio-other-tools-section";

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
  /** Composio toolkit slugs to pre-select. Defaults to none. */
  initialComposioToolkitSlugs?: string[];
  /** The ID of the agent once saved — enables the Run a test button. Defaults to null (disabled). */
  createdAgentId?: string | null;
  /** The run ID to show inline console for, or null if no test has been run yet. */
  testRunId?: string | null;
  /** Button label for the primary save action. */
  saveLabel?: string;
  /** Detail page shown after a newly created agent is saved. */
  savedAgentHref?: string | null;
  /** Action feedback shown next to Save/Run controls. */
  statusMessage?: { kind: "success" | "error"; text: string } | null;
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
  initialComposioToolkitSlugs = [],
  createdAgentId = null,
  testRunId = null,
  saveLabel = "Save",
  savedAgentHref = null,
  statusMessage = null,
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
  // Normalize any mixed initial GitHub access (e.g. a legacy agent saved with
  // contents:write + pullRequests:read) to what the tool card can represent, so
  // the card never displays "Read-only" while the form silently holds a write
  // that would persist unchanged on the next save.
  const normalizedAccess: GitHubAccessLevel =
    permissionsToAccess(
      initialPermissionContents,
      initialPermissionPullRequests,
    ) === "pr"
      ? "write"
      : "read";
  const [permissionContents, setPermissionContents] =
    useState<GitHubAccessLevel>(normalizedAccess);
  const [permissionPullRequests, setPermissionPullRequests] =
    useState<GitHubAccessLevel>(normalizedAccess);
  const [composioToolkitSlugs, setComposioToolkitSlugs] = useState<string[]>(
    initialComposioToolkitSlugs,
  );

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
      composioToolkitSlugs,
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

  function handleGitHubAccessChange(level: GitHubToolAccess) {
    if (level === "pr") {
      setPermissionContents("write");
      setPermissionPullRequests("write");
    } else {
      setPermissionContents("read");
      setPermissionPullRequests("read");
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
              {saving ? "Saving" : saveLabel}
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
            {savedAgentHref ? (
              <Button asChild variant="ghost">
                <Link href={savedAgentHref}>
                  View agent
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
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
              : "Agent saved. Run a test, keep editing, or turn it on when ready."}
        </p>
        {statusMessage ? (
          <p
            aria-live="polite"
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              statusMessage.kind === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
            role="status"
          >
            {statusMessage.text}
          </p>
        ) : null}
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

      {/* 4 — Tools */}
      <SettingsSection
        title="Tools"
        description="The apps and abilities this agent can use."
      >
        <div className="space-y-4">
          <GitHubToolCard
            access={permissionsToAccess(
              permissionContents,
              permissionPullRequests,
            )}
            onChange={handleGitHubAccessChange}
            disabled={saving}
          />
          <ComposioOtherToolsSection
            selectedSlugs={composioToolkitSlugs}
            onChange={setComposioToolkitSlugs}
            disabled={saving}
            repoOwner={repoOwner}
            repoName={repoName}
          />
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
