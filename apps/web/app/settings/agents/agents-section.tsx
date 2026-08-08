"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { AgentConfigFields } from "@/components/agent-config-fields";
import { readApiError } from "@/lib/api/read-api-error";
import { useModelOptions } from "@/hooks/use-model-options";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import {
  EXTERNAL_TOOLS_NONE_ASSIGNED_HINT,
  EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL,
} from "./agents-copy";
import {
  INHERIT_SENTINEL,
  fromSelectValue,
  toSelectValue,
} from "./inherit-select-value";
import type { AgentRosterRow } from "./agents-roster";

/** Map each role to a subtitle shown beneath the role name in the card. */
const ROLE_SUBTITLES: Record<AgentRosterRow["key"], string> = {
  main: "Session coordinator",
  explorer: "Helper role",
  executor: "Helper role",
  design: "Helper role",
};

const RUNTIME_PROFILES = listManagedRuntimeProfiles();

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentPatch = {
  modelId?: string | null;
  composioToolkitSlugs?: string[];
  instructions?: string | null;
  managedRuntimeProfileId?: string | null;
  githubToolsEnabled?: boolean;
  toolAuthoringEnabled?: boolean;
};

// ── Collapsed summary cell ────────────────────────────────────────────────────

function FieldCell({
  label,
  value,
  hint,
  isCustom,
}: {
  label: string;
  value: string;
  hint?: string;
  isCustom?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {isCustom ? (
          <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
            Custom
          </span>
        ) : null}
      </div>
      <span className="text-sm font-medium">{value}</span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

// ── Inline editor ─────────────────────────────────────────────────────────────

function AgentEditor({
  row,
  onSaved,
  onReset,
  onCancel,
}: {
  row: AgentRosterRow;
  onSaved: () => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const { modelOptions } = useModelOptions();
  // Recompose the same "user-profile:<profileId>:<modelId>" composite the
  // Model picker's own options use (buildModelOptions), so a profile-bound
  // role's own-key routing shows selected AND an untouched Save round-trips
  // it instead of silently dropping it (#1157).
  const [modelId, setModelId] = useState<string>(
    getModelOptionSelectionId(row.model, row.inferenceProfileId),
  );
  const [slugs, setSlugs] = useState<string[]>(row.composioToolkitSlugs);
  const [instructions, setInstructions] = useState<string>(
    row.instructions ?? "",
  );
  const [runtimeProfileId, setRuntimeProfileId] = useState<string>(
    row.runtimeCustom
      ? (RUNTIME_PROFILES.find((p) => p.displayName === row.runtimeLabel)?.id ??
          "")
      : "",
  );
  const [githubToolsEnabled, setGithubToolsEnabled] = useState<boolean>(
    row.githubToolsEnabled,
  );
  const [toolAuthoringEnabled, setToolAuthoringEnabled] = useState<boolean>(
    row.toolAuthoringEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const patch: AgentPatch & { role: string } = {
        role: row.key,
        modelId: modelId.trim() || null,
        composioToolkitSlugs: slugs,
        instructions: instructions.trim() || null,
        managedRuntimeProfileId: runtimeProfileId.trim() || null,
        ...(row.key === "main"
          ? { githubToolsEnabled, toolAuthoringEnabled }
          : {}),
      };

      const res = await fetch("/api/settings/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(
          readApiError(body, "Failed to save role settings.").message,
        );
        return;
      }

      toast.success(`${row.name} role updated.`);
      onSaved();
    } catch {
      toast.error("Failed to save role settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch("/api/settings/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: row.key }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(
          readApiError(body, "Failed to reset role settings.").message,
        );
        return;
      }

      toast.success(`${row.name} role reset to defaults.`);
      onReset();
    } catch {
      toast.error("Failed to reset role settings.");
    } finally {
      setResetting(false);
    }
  }

  const isBusy = saving || resetting;

  return (
    <div className="space-y-4 border-t border-border pt-4">
      {/* Model */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Model
        </span>
        <Select
          value={toSelectValue(modelId)}
          onValueChange={(v) => setModelId(fromSelectValue(v))}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Inherit default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_SENTINEL}>Inherit default</SelectItem>
            {modelOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Leave blank to inherit the default model from Preferences.
        </p>
      </div>

      <AgentConfigFields
        className="space-y-4"
        instructions={{
          id: `agent-instructions-${row.key}`,
          value: instructions,
          onChange: setInstructions,
          placeholder: "Leave blank to use the built-in prompt for this role.",
          rows: 4,
          disabled: isBusy,
          expandedTitle: `${row.name} instructions`,
          expandedDescription:
            "Custom instructions override the built-in prompt for this role. Leave blank to inherit the default behavior.",
          expandedAriaLabel: `${row.name} instructions expanded editor`,
        }}
        tools={{
          label: "External tools",
          selectedSlugs: slugs,
          onChange: setSlugs,
          disabled: isBusy,
          source: "connected",
          help: "Built-in file editing & commands are always on.",
        }}
        githubPermissions={
          row.key === "main"
            ? {
                githubToolsEnabled,
                onGithubToolsEnabledChange: setGithubToolsEnabled,
                toolAuthoringEnabled,
                onToolAuthoringEnabledChange: setToolAuthoringEnabled,
                disabled: isBusy,
                presentationNoun: "role",
              }
            : undefined
        }
      />

      {/* Runtime profile */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Runtime profile
        </span>
        <Select
          value={toSelectValue(runtimeProfileId)}
          onValueChange={(v) => setRuntimeProfileId(fromSelectValue(v))}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Inherit default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_SENTINEL}>Inherit default</SelectItem>
            {RUNTIME_PROFILES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isBusy}
        >
          {resetting ? "Resetting…" : "Reset to default"}
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isBusy}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Agent card (collapsed + expandable editor) ────────────────────────────────

function AgentCard({
  row,
  onAgentSaved,
  onAgentReset,
}: {
  row: AgentRosterRow;
  onAgentSaved: () => void;
  onAgentReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const subtitle = ROLE_SUBTITLES[row.key];
  const modelValue = row.modelInherited
    ? "Inherits Main"
    : (row.model ?? "Default");

  function handleSaved() {
    setExpanded(false);
    onAgentSaved();
  }

  function handleReset() {
    setExpanded(false);
    onAgentReset();
  }

  return (
    <SettingsSection
      title={`${row.name} · ${subtitle}`}
      description={row.description}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1"
        >
          {expanded ? (
            <>
              Done
              <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              Edit
              <ChevronDown className="size-3.5" />
            </>
          )}
        </Button>
      }
    >
      {/* Collapsed summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FieldCell
          label="Model"
          value={modelValue}
          isCustom={row.modelCustom}
        />
        <FieldCell
          label="External tools"
          value={
            row.toolsLabel === "None"
              ? EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL
              : row.toolsLabel
          }
          hint={
            row.toolsLabel === "None"
              ? EXTERNAL_TOOLS_NONE_ASSIGNED_HINT
              : "Built-in file editing &amp; commands are always on."
          }
          isCustom={row.toolsCustom}
        />
        <FieldCell
          label="Instructions"
          value={row.instructionsCustom ? "Custom" : "Built-in"}
          isCustom={row.instructionsCustom}
        />
        <FieldCell
          label="Runtime"
          value={row.runtimeLabel}
          isCustom={row.runtimeCustom}
        />
      </div>

      {/* Inline editor */}
      {expanded ? (
        <AgentEditor
          row={row}
          onSaved={handleSaved}
          onReset={handleReset}
          onCancel={() => setExpanded(false)}
        />
      ) : null}
    </SettingsSection>
  );
}

// ── Public exports ────────────────────────────────────────────────────────────

export function AgentsSection({
  rows,
  onAgentSaved,
  onAgentReset,
}: {
  rows: AgentRosterRow[];
  onAgentSaved?: () => void;
  onAgentReset?: () => void;
}) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <AgentCard
          key={row.key}
          row={row}
          onAgentSaved={onAgentSaved ?? (() => undefined)}
          onAgentReset={onAgentReset ?? (() => undefined)}
        />
      ))}
    </div>
  );
}

export function AgentsSectionSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-xl border border-border bg-muted"
        />
      ))}
    </div>
  );
}
