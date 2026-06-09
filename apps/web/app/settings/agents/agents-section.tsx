"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/components/ui/settings-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { ComposioToolkitPicker } from "@/app/settings/composio-toolkit-picker";
import type { AgentRosterRow } from "./agents-roster";

/** Map each role to a subtitle shown beneath the role name in the card. */
const ROLE_SUBTITLES: Record<AgentRosterRow["key"], string> = {
  main: "Chat coordinator",
  explorer: "Subagent",
  executor: "Subagent",
  design: "Subagent",
};

const RUNTIME_PROFILES = listManagedRuntimeProfiles();

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentPatch = {
  modelId?: string | null;
  composioToolkitSlugs?: string[];
  instructions?: string | null;
  managedRuntimeProfileId?: string | null;
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
  const [modelId, setModelId] = useState<string>(row.model ?? "");
  const [slugs, setSlugs] = useState<string[]>(
    row.toolsCustom
      ? row.toolsLabel.includes("toolkit")
        ? [] // slugs not directly on row, start empty
        : []
      : [],
  );
  const [instructions, setInstructions] = useState<string>(
    row.instructions ?? "",
  );
  const [runtimeProfileId, setRuntimeProfileId] = useState<string>(
    row.runtimeCustom
      ? (RUNTIME_PROFILES.find((p) => p.displayName === row.runtimeLabel)?.id ??
          "")
      : "",
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
      };

      const res = await fetch("/api/settings/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        toast.error(body.error ?? "Failed to save agent settings.");
        return;
      }

      toast.success(`${row.name} agent updated.`);
      onSaved();
    } catch {
      toast.error("Failed to save agent settings.");
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
        const body = (await res.json()) as { error?: string };
        toast.error(body.error ?? "Failed to reset agent settings.");
        return;
      }

      toast.success(`${row.name} agent reset to defaults.`);
      onReset();
    } catch {
      toast.error("Failed to reset agent settings.");
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
        <Select value={modelId} onValueChange={setModelId} disabled={isBusy}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Inherit default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Inherit default</SelectItem>
            <SelectItem value="anthropic/claude-opus-4-5">
              Claude Opus 4.5
            </SelectItem>
            <SelectItem value="anthropic/claude-sonnet-4-5">
              Claude Sonnet 4.5
            </SelectItem>
            <SelectItem value="anthropic/claude-3-5-haiku">
              Claude 3.5 Haiku
            </SelectItem>
            <SelectItem value="openai/gpt-4o">GPT-4o</SelectItem>
            <SelectItem value="openai/o3">o3</SelectItem>
            <SelectItem value="google/gemini-2.0-flash">
              Gemini 2.0 Flash
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Leave blank to inherit the default model from Preferences.
        </p>
      </div>

      {/* External tools */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          External tools
        </span>
        <p className="text-xs text-muted-foreground">
          Built-in file editing &amp; commands are always on.
        </p>
        <ComposioToolkitPicker
          selectedSlugs={slugs}
          onChange={setSlugs}
          disabled={isBusy}
          source="connected"
        />
      </div>

      {/* Instructions */}
      <div className="space-y-1.5">
        <label
          htmlFor={`agent-instructions-${row.key}`}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Instructions
        </label>
        <Textarea
          id={`agent-instructions-${row.key}`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Leave blank to use the built-in prompt for this role."
          rows={4}
          disabled={isBusy}
        />
      </div>

      {/* Runtime profile */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Runtime profile
        </span>
        <Select
          value={runtimeProfileId}
          onValueChange={setRuntimeProfileId}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Inherit default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Inherit default</SelectItem>
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
          value={row.toolsLabel === "None" ? "None connected" : row.toolsLabel}
          hint="Built-in file editing &amp; commands are always on."
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
