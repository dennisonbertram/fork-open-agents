"use client";

/**
 * loop-settings-panel.tsx — Gear button in the builder top bar opens a docked
 * panel for editing loop-level settings: name, description, and guardrails.
 *
 * Saves via PATCH /api/agent-loops/[loopId] which already supports name,
 * description, and guardrails in updateAgentLoopBodySchema.
 */

import { useState } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
  type LoopGuardrails,
} from "@/lib/agent-loops/types";
import { validateLoopSettings } from "./loop-settings-panel";
import { cn } from "@/lib/utils";

// ── Field sub-components ──────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-foreground"
    >
      {children}
    </label>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
      {children}
    </p>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-0.5 min-h-[14px] text-[11px] text-red-600 dark:text-red-400 leading-snug">
      {message}
    </p>
  );
}

// ── GuardrailField ────────────────────────────────────────────────────────────

type GuardrailFieldKey = keyof LoopGuardrails;

function GuardrailNumberField({
  id,
  label,
  help,
  value,
  placeholder,
  ceiling,
  error,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: number | undefined;
  placeholder: number;
  ceiling?: number;
  error?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="number"
        className={cn(
          "w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error ? "border-red-400" : "border-input",
        )}
        value={value ?? ""}
        placeholder={String(placeholder)}
        min={1}
        max={ceiling}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? undefined : n);
        }}
      />
      {/* Reserve space to avoid layout shift */}
      {error ? <FieldError message={error} /> : <FieldHelp>{help}</FieldHelp>}
    </div>
  );
}

// ── LoopSettingsPanelContent ──────────────────────────────────────────────────

type LoopSettingsPanelContentProps = {
  loopId: string;
  initialName: string;
  initialDescription?: string | null;
  initialGuardrails?: LoopGuardrails;
  onClose: () => void;
};

function LoopSettingsPanelContent({
  loopId,
  initialName,
  initialDescription,
  initialGuardrails,
  onClose,
}: LoopSettingsPanelContentProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [guardrails, setGuardrails] = useState<Partial<LoopGuardrails>>(
    initialGuardrails ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});

  function setGuardrailField(
    key: GuardrailFieldKey,
    value: number | undefined,
  ) {
    setGuardrails((prev) => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
    // Clear field error on change
    setFieldErrors((prev) => ({ ...prev, [`guardrails.${key}`]: undefined }));
  }

  async function handleSave() {
    const input = {
      name,
      description: description || null,
      guardrails:
        Object.keys(guardrails).length > 0
          ? (guardrails as LoopGuardrails)
          : undefined,
    };

    const result = validateLoopSettings(input);
    if (!result.ok) {
      const errors: Record<string, string> = {};
      for (const err of result.errors) {
        errors[err.field] = err.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/agent-loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(body.message ?? "Failed to save settings.");
        return;
      }

      toast.success("Settings saved.");
      onClose();
    } catch {
      toast.error("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 p-4">
      {/* Name */}
      <div className="space-y-1">
        <FieldLabel htmlFor="settings-name">Name</FieldLabel>
        <input
          id="settings-name"
          type="text"
          className={cn(
            "w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            fieldErrors["name"] ? "border-red-400" : "border-input",
          )}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />
        {fieldErrors["name"] ? (
          <FieldError message={fieldErrors["name"]!} />
        ) : (
          <FieldHelp>Loop name shown in the dashboard.</FieldHelp>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <FieldLabel htmlFor="settings-description">Description</FieldLabel>
        <textarea
          id="settings-description"
          className="min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this loop do?"
        />
      </div>

      <hr className="border-border" />

      {/* Guardrails */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Guardrails
        </p>
      </div>

      <GuardrailNumberField
        id="max-steps"
        label="Max steps per run"
        help={`Default: ${GUARDRAIL_DEFAULTS.maxStepsPerRun}. Server enforces a ceiling of ${GUARDRAIL_CEILINGS.maxStepsPerRun}.`}
        value={guardrails.maxStepsPerRun}
        placeholder={GUARDRAIL_DEFAULTS.maxStepsPerRun}
        ceiling={GUARDRAIL_CEILINGS.maxStepsPerRun}
        error={fieldErrors["guardrails.maxStepsPerRun"]}
        onChange={(v) => setGuardrailField("maxStepsPerRun", v)}
      />

      <GuardrailNumberField
        id="max-iterations"
        label="Max iterations"
        help={`Default: ${GUARDRAIL_DEFAULTS.maxIterations}. Server enforces a ceiling of ${GUARDRAIL_CEILINGS.maxIterations}.`}
        value={guardrails.maxIterations}
        placeholder={GUARDRAIL_DEFAULTS.maxIterations}
        ceiling={GUARDRAIL_CEILINGS.maxIterations}
        error={fieldErrors["guardrails.maxIterations"]}
        onChange={(v) => setGuardrailField("maxIterations", v)}
      />

      <GuardrailNumberField
        id="max-run-duration"
        label="Max run duration (ms)"
        help={`Default: ${GUARDRAIL_DEFAULTS.maxRunDurationMs.toLocaleString()} ms (2 hours). No server ceiling.`}
        value={guardrails.maxRunDurationMs}
        placeholder={GUARDRAIL_DEFAULTS.maxRunDurationMs}
        error={fieldErrors["guardrails.maxRunDurationMs"]}
        onChange={(v) => setGuardrailField("maxRunDurationMs", v)}
      />

      <GuardrailNumberField
        id="step-timeout"
        label="Step timeout (ms)"
        help={`Default: ${GUARDRAIL_DEFAULTS.stepTimeoutMs.toLocaleString()} ms. Server enforces a ceiling of ${GUARDRAIL_CEILINGS.stepTimeoutMs.toLocaleString()} ms.`}
        value={guardrails.stepTimeoutMs}
        placeholder={GUARDRAIL_DEFAULTS.stepTimeoutMs}
        ceiling={GUARDRAIL_CEILINGS.stepTimeoutMs}
        error={fieldErrors["guardrails.stepTimeoutMs"]}
        onChange={(v) => setGuardrailField("stepTimeoutMs", v)}
      />

      {/* Save */}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── LoopSettingsPanel ─────────────────────────────────────────────────────────

export type LoopSettingsPanelProps = {
  loopId: string;
  loopName: string;
  loopDescription?: string | null;
  guardrails?: LoopGuardrails;
};

export function LoopSettingsPanel({
  loopId,
  loopName,
  loopDescription,
  guardrails,
}: LoopSettingsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Gear button in top bar */}
      <Button
        variant="ghost"
        size="sm"
        className="size-8 p-0"
        onClick={() => setOpen((v) => !v)}
        aria-label="Loop settings"
        title="Loop settings"
      >
        <Settings className="size-4" />
      </Button>

      {/* Docked settings panel (right side, over canvas) */}
      {open && (
        <div className="absolute right-0 top-12 z-30 flex h-[calc(100vh-3rem)] w-80 flex-col border-l border-border bg-background shadow-lg">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
            <p className="text-sm font-medium text-foreground">Loop settings</p>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setOpen(false)}
              aria-label="Close settings"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <LoopSettingsPanelContent
              loopId={loopId}
              initialName={loopName}
              initialDescription={loopDescription}
              initialGuardrails={guardrails}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
