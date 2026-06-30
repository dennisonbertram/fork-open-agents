"use client";

import { ChevronDown, Play, Save, X } from "lucide-react";
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
  createTriggerDraft,
  deriveAgentName,
  describeAgentOutput,
  supportedOutputModes,
  triggerLabels,
  type FormState,
  type GitHubAccessLevel,
  type OutputMode,
  type TriggerDraft,
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
  /**
   * Multi-trigger drafts to seed the trigger list. When provided and non-empty,
   * takes priority over the scalar initialTriggerKind/initialSchedule/initialCondition* props.
   */
  initialTriggers?: TriggerDraft[];
  /** The ID of the agent once saved — enables the Run a test button. Defaults to null (disabled). */
  createdAgentId?: string | null;
  /** The run ID to show inline console for, or null if no test has been run yet. */
  testRunId?: string | null;
  onSave: (
    payload: ReturnType<typeof buildAgentPayload>,
  ) => void | Promise<void>;
  onRunTest: () => void | Promise<void>;
};

/** Builds condition open/close state per trigger index. */
type ConditionsOpenState = Record<number, boolean>;

/**
 * Reviewed/editable spec form for creating a GitHub project agent.
 *
 * - Repo owner/name are shown in the breadcrumb, NOT as a field here.
 * - Agent starts disabled by default.
 * - No auto-merge controls (v1 autonomy = draft PR / report only).
 * - ready_pr output makes GitHub write/PR permissions explicit.
 * - schedule.cron trigger mounts the schedule components visibly.
 * - Actions (Save + Run a test) are at the TOP of the editor.
 * - Sentence ordering: Instructions → Triggers → Tools → Result.
 * - Multiple triggers supported via "Add a trigger" button.
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
  initialTriggers,
  createdAgentId = null,
  testRunId = null,
  onSave,
  onRunTest,
}: AgentSpecEditorProps) {
  const [name, setName] = useState(initialName);
  // Merge goal into instructions once, as the initial value: prepend the goal as
  // the first sentence when present. Computed in a lazy useState initializer so
  // later edits live entirely in `instructions` state (no deps to track).
  const [instructions, setInstructions] = useState(() => {
    if (!initialGoal) return initialInstructions;
    if (initialInstructions.startsWith(initialGoal)) return initialInstructions;
    return `${initialGoal}\n\n${initialInstructions}`.trim();
  });

  // Multi-trigger state: seed from initialTriggers if provided, else from
  // scalar props (back-compat).
  const [triggers, setTriggers] = useState<TriggerDraft[]>(() => {
    if (initialTriggers && initialTriggers.length > 0) return initialTriggers;
    const seed = createTriggerDraft("trigger-0", initialTriggerKind);
    return [
      {
        ...seed,
        schedule: initialSchedule,
        conditionActions: initialConditionActions,
        conditionBranches: initialConditionBranches,
        conditionLabels: initialConditionLabels,
        conditionEnvironments: initialConditionEnvironments,
        conditionSeverities: initialConditionSeverities,
      },
    ];
  });

  const [conditionsOpen, setConditionsOpen] = useState<ConditionsOpenState>({});

  const [outputMode, setOutputMode] = useState<OutputMode>(initialOutputMode);
  const [checkCommand, setCheckCommand] = useState(initialCheckCommand);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
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

  const allCronSchedulesValid = useMemo(() => {
    return triggers.every(
      (t) =>
        t.triggerKind !== "schedule.cron" || validateSchedule(t.schedule).valid,
    );
  }, [triggers]);

  const canSave = useMemo(
    () =>
      (name.trim().length > 0 || instructions.trim().length > 0) &&
      instructions.trim().length > 0 &&
      triggers.length > 0 &&
      allCronSchedulesValid,
    [name, instructions, triggers, allCronSchedulesValid],
  );

  // --- Trigger list mutators ---

  function updateTrigger(index: number, patch: Partial<TriggerDraft>) {
    setTriggers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  function addTrigger() {
    const newId = `trigger-${Date.now()}`;
    setTriggers((prev) => [...prev, createTriggerDraft(newId)]);
  }

  function removeTrigger(index: number) {
    if (triggers.length <= 1) return;
    setTriggers((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleConditionsOpen(index: number) {
    setConditionsOpen((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  // --- Payload builder ---

  function buildCurrentPayload() {
    // Auto-derive name from instructions when name is empty at save time.
    const effectiveName =
      name.trim().length > 0 ? name.trim() : deriveAgentName(instructions);

    const form: FormState = {
      name: effectiveName,
      repoOwner,
      repoName,
      // Scalar fields are still required by FormState for back-compat with
      // the settings form path. Use first trigger's values.
      triggerKind: triggers[0]?.triggerKind ?? "github.pull_request",
      schedule: triggers[0]?.schedule ?? "",
      conditionActions: triggers[0]?.conditionActions ?? "",
      conditionBranches: triggers[0]?.conditionBranches ?? "",
      conditionLabels: triggers[0]?.conditionLabels ?? "",
      conditionEnvironments: triggers[0]?.conditionEnvironments ?? "",
      conditionSeverities: triggers[0]?.conditionSeverities ?? "",
      instructions,
      outputMode,
      checkCommand,
      enabled,
      permissionContents,
      permissionPullRequests,
      composioToolkitSlugs,
      // Multi-trigger path: always emit triggers array when length > 0.
      triggers,
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
        {/* 3-step progression: ① Save → ② Run a test → ③ Enable */}
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
          <li className={cn("flex items-center gap-1", createdAgentId ? "text-emerald-600 dark:text-emerald-400" : "font-medium text-foreground")}>
            {createdAgentId ? <span aria-label="done">✓</span> : <span>①</span>}
            Save
          </li>
          <li className={cn("flex items-center gap-1", testRunId ? "text-emerald-600 dark:text-emerald-400" : createdAgentId ? "font-medium text-foreground" : "opacity-40")}>
            {testRunId ? <span aria-label="done">✓</span> : <span>②</span>}
            Run a test
          </li>
          <li className={cn("flex items-center gap-1", enabled ? "text-emerald-600 dark:text-emerald-400" : testRunId ? "font-medium text-foreground" : "opacity-40")}>
            {enabled ? <span aria-label="done">✓</span> : <span>③</span>}
            Enable
          </li>
        </ol>
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

      {/* Name — small/secondary at top */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="spec-name" className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input
          id="spec-name"
          aria-label="Agent name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. PR Backlog Maintainer (auto-derived from instructions if left blank)"
          className="text-sm"
        />
      </div>

      {/* 1 — What should this agent do? (merged goal + instructions) */}
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

      {/* 2 — When should it run? (trigger list) */}
      <SettingsSection
        title="When should it run?"
        description="Pick what wakes this agent up. Add multiple triggers if it should respond to different events."
      >
        <div className="space-y-4">
          {triggers.map((trigger, index) => (
            <TriggerBlock
              key={trigger.id}
              trigger={trigger}
              index={index}
              canRemove={triggers.length > 1}
              conditionsOpen={!!conditionsOpen[index]}
              onUpdate={(patch) => updateTrigger(index, patch)}
              onRemove={() => removeTrigger(index)}
              onToggleConditions={() => toggleConditionsOpen(index)}
            />
          ))}
          {/* Add a trigger */}
          <button
            type="button"
            onClick={addTrigger}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Add a trigger
          </button>
        </div>
      </SettingsSection>

      {/* 3 — Tools */}
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

      {/* 4 — Result (output mode) */}
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
        {/* AND IT WILL… output summary */}
        {(() => {
          const githubAccess = permissionContents === "write" ? "write" : "read";
          const { will, wont } = describeAgentOutput({ outputMode, githubAccess });
          return (
            <div className="mb-3 rounded-md border border-border bg-muted/10 px-3 py-2 text-xs space-y-0.5">
              <p>
                <span className="font-medium">It will</span>{" "}
                {will.replace(/^It will /i, "").replace(/\.$/, "")}.
              </p>
              <p className="text-muted-foreground">{wont}</p>
            </div>
          );
        })()}
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

/** One trigger block in the list — kind select + optional schedule/conditions. */
function TriggerBlock({
  trigger,
  index,
  canRemove,
  conditionsOpen,
  onUpdate,
  onRemove,
  onToggleConditions,
}: {
  trigger: TriggerDraft;
  index: number;
  canRemove: boolean;
  conditionsOpen: boolean;
  onUpdate: (patch: Partial<TriggerDraft>) => void;
  onRemove: () => void;
  onToggleConditions: () => void;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Select
          value={trigger.triggerKind}
          onValueChange={(v) => onUpdate({ triggerKind: v as TriggerKind })}
        >
          <SelectTrigger id={`spec-trigger-${index}`} className="flex-1">
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
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove trigger"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {trigger.triggerKind === "schedule.cron" && (
        <SchedulePicker
          schedule={trigger.schedule}
          onChange={(s) => onUpdate({ schedule: s })}
        />
      )}

      {/* Conditions disclosure — always rendered (CSS hidden) so labels appear in SSR */}
      <div className="border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={onToggleConditions}
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
        <div className={cn("mt-3", conditionsOpen ? "" : "hidden")}>
          <EventTriggerConditions
            triggerKind={trigger.triggerKind}
            conditionActions={trigger.conditionActions}
            conditionBranches={trigger.conditionBranches}
            conditionLabels={trigger.conditionLabels}
            conditionEnvironments={trigger.conditionEnvironments}
            conditionSeverities={trigger.conditionSeverities}
            onConditionActionsChange={(v) => onUpdate({ conditionActions: v })}
            onConditionBranchesChange={(v) =>
              onUpdate({ conditionBranches: v })
            }
            onConditionLabelsChange={(v) => onUpdate({ conditionLabels: v })}
            onConditionEnvironmentsChange={(v) =>
              onUpdate({ conditionEnvironments: v })
            }
            onConditionSeveritiesChange={(v) =>
              onUpdate({ conditionSeverities: v })
            }
          />
        </div>
      </div>
    </div>
  );
}
