"use client";

import { ChevronDown, Play, Save } from "lucide-react";
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
  defaultGithubActions,
  defaultWriteScope,
  triggerLabels,
  type FormState,
  type GitHubAccessLevel,
  type GithubActions,
  type TriggerKind,
  type WriteScope,
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
import { GithubActionsPanel } from "./github-actions-panel";

type AgentSpecEditorProps = {
  /** "create" (default) shows creation-oriented copy; "edit" shows update-oriented copy. */
  mode?: "create" | "edit";
  repoOwner: string;
  repoName: string;
  initialName: string;
  initialGoal: string;
  initialTriggerKind: TriggerKind;
  initialInstructions: string;
  initialCheckCommand: string;
  initialEnabled: boolean;
  initialSchedule?: string;
  initialConditionActions?: string;
  initialConditionBranches?: string;
  initialConditionLabels?: string;
  initialConditionEnvironments?: string;
  initialConditionSeverities?: string;
  initialConditionActors?: string;
  initialConditionIgnoreActors?: string;
  initialPermissionContents?: GitHubAccessLevel;
  initialPermissionPullRequests?: GitHubAccessLevel;
  /** Composio toolkit slugs to pre-select. Defaults to none. */
  initialComposioToolkitSlugs?: string[];
  /** Saved/initial GitHub action toggles. Defaults to open PR + comment on. */
  initialGithubActions?: GithubActions;
  /** Saved/initial write scope. Defaults to "this_repo". */
  initialWriteScope?: WriteScope;
  /** Saved/initial CI-green-for-merge toggle. Defaults to true. */
  initialRequireCiGreenForMerge?: boolean;
  /** Saved/initial explicit model selection. Defaults to null (inherit default model). */
  initialModelId?: string | null;
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
  initialCheckCommand,
  initialEnabled,
  initialSchedule = "",
  initialConditionActions = "",
  initialConditionBranches = "",
  initialConditionLabels = "",
  initialConditionEnvironments = "",
  initialConditionSeverities = "",
  initialConditionActors = "",
  initialConditionIgnoreActors = "",
  initialPermissionContents = "read",
  initialPermissionPullRequests = "read",
  initialComposioToolkitSlugs = [],
  initialGithubActions,
  initialWriteScope,
  initialRequireCiGreenForMerge = true,
  initialModelId = null,
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
  const [conditionActors, setConditionActors] = useState(
    initialConditionActors,
  );
  const [conditionIgnoreActors, setConditionIgnoreActors] = useState(
    initialConditionIgnoreActors,
  );
  // Merge goal into instructions once, as the initial value: prepend the goal as
  // the first sentence when present. Computed in a lazy useState initializer so
  // later edits live entirely in `instructions` state (no deps to track).
  const [instructions, setInstructions] = useState(() => {
    if (!initialGoal) return initialInstructions;
    if (initialInstructions.startsWith(initialGoal)) return initialInstructions;
    return `${initialGoal}\n\n${initialInstructions}`.trim();
  });
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
  const [githubActions, setGithubActions] = useState<GithubActions>(
    initialGithubActions ?? { ...defaultGithubActions },
  );
  const [writeScope, setWriteScope] = useState<WriteScope>(
    initialWriteScope ?? { ...defaultWriteScope },
  );
  const [requireCiGreenForMerge, setRequireCiGreenForMerge] = useState(
    initialRequireCiGreenForMerge,
  );
  const [modelId, setModelId] = useState<string | null>(initialModelId);

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
      conditionActors,
      conditionIgnoreActors,
      instructions,
      checkCommand,
      enabled,
      permissionContents,
      permissionPullRequests,
      composioToolkitSlugs,
      githubActions,
      writeScope,
      requireCiGreenForMerge,
      modelId,
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

  function hasAnyWriteAction(actions: GithubActions): boolean {
    return Boolean(
      actions.open_pull_request ||
      actions.approve_pull_request ||
      actions.request_changes ||
      actions.merge_pull_request ||
      actions.push ||
      actions.delete_branch,
    );
  }

  function handleActionsPanelChange(next: {
    githubActions: GithubActions;
    writeScope: WriteScope;
    requireCiGreenForMerge: boolean;
    modelId: string | null;
  }) {
    setGithubActions(next.githubActions);
    setWriteScope(next.writeScope);
    setRequireCiGreenForMerge(next.requireCiGreenForMerge);
    setModelId(next.modelId);
    // Auto-coerce the Tools card permissions to write when a write action is
    // newly enabled. Only on this transition — so the user can still
    // override back to read after the initial coerce without losing their
    // choice — mirrors the old ready_pr-transition coercion.
    if (hasAnyWriteAction(next.githubActions)) {
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
                conditionActors={conditionActors}
                conditionIgnoreActors={conditionIgnoreActors}
                onConditionActionsChange={setConditionActions}
                onConditionBranchesChange={setConditionBranches}
                onConditionLabelsChange={setConditionLabels}
                onConditionEnvironmentsChange={setConditionEnvironments}
                onConditionSeveritiesChange={setConditionSeverities}
                onConditionActorsChange={setConditionActors}
                onConditionIgnoreActorsChange={setConditionIgnoreActors}
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

      {/* 5 — GitHub actions (automation toggles, write scope, CI-green, model) */}
      <SettingsSection
        title="GitHub actions"
        description="What this agent is allowed to do on GitHub, where, and with which model."
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
        <GithubActionsPanel
          value={{ githubActions, writeScope, requireCiGreenForMerge, modelId }}
          onChange={handleActionsPanelChange}
          disabled={saving}
        />
      </SettingsSection>
    </div>
  );
}
