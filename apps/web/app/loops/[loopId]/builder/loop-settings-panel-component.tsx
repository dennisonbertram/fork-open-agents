"use client";

/**
 * loop-settings-panel.tsx — Gear button in the builder top bar opens a docked
 * panel for editing loop-level settings: name, description, guardrails, and watchdog.
 *
 * Saves via PATCH /api/agent-loops/[loopId] which supports name, description,
 * guardrails, and watchdog fields (M3-01) in updateAgentLoopBodySchema.
 */

import { useState } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
  type LoopGuardrails,
} from "@/lib/agent-loops/types";
import {
  validateLoopSettings,
  WATCHDOG_RETRY_BUDGET_DEFAULT,
  WATCHDOG_RETRY_BUDGET_MAX,
} from "./loop-settings-panel";
import { cn } from "@/lib/utils";

// ── Duration helpers — the UI works in minutes; guardrails are stored in ms ───

const MS_PER_MIN = 60_000;

/** Round a known ms value to whole minutes (for defaults/ceilings). */
function msToMin(ms: number): number {
  return Math.round(ms / MS_PER_MIN);
}

/** Round an optional ms value to whole minutes, preserving undefined. */
function msToMinOpt(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : Math.round(ms / MS_PER_MIN);
}

// ── Field sub-components ──────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children}
    </Label>
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
      <Input
        id={id}
        type="number"
        className={cn(error ? "border-destructive" : undefined)}
        aria-invalid={error ? true : undefined}
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
  initialWatchdogEnabled?: boolean;
  initialWatchdogInstructions?: string | null;
  initialWatchdogRetryBudget?: number;
  onClose: () => void;
};

function LoopSettingsPanelContent({
  loopId,
  initialName,
  initialDescription,
  initialGuardrails,
  initialWatchdogEnabled = false,
  initialWatchdogInstructions,
  initialWatchdogRetryBudget,
  onClose,
}: LoopSettingsPanelContentProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [guardrails, setGuardrails] = useState<Partial<LoopGuardrails>>(
    initialGuardrails ?? {},
  );
  const [watchdogEnabled, setWatchdogEnabled] = useState(
    initialWatchdogEnabled,
  );
  const [watchdogInstructions, setWatchdogInstructions] = useState(
    initialWatchdogInstructions ?? "",
  );
  const [watchdogRetryBudget, setWatchdogRetryBudget] = useState<number>(
    initialWatchdogRetryBudget ?? WATCHDOG_RETRY_BUDGET_DEFAULT,
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
      watchdog: {
        watchdogEnabled,
        watchdogInstructions: watchdogInstructions || null,
        watchdogRetryBudget,
      },
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

    // Build the API payload — flatten watchdog fields for the PATCH endpoint
    const apiPayload = {
      name,
      description: description || null,
      guardrails:
        Object.keys(guardrails).length > 0
          ? (guardrails as LoopGuardrails)
          : undefined,
      watchdogEnabled,
      watchdogInstructions: watchdogEnabled
        ? watchdogInstructions || null
        : null,
      watchdogRetryBudget,
    };

    setSaving(true);
    try {
      const res = await fetch(`/api/agent-loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
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
        <Input
          id="settings-name"
          type="text"
          className={cn(fieldErrors["name"] ? "border-destructive" : undefined)}
          aria-invalid={fieldErrors["name"] ? true : undefined}
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
        <Textarea
          id="settings-description"
          className="min-h-[60px] resize-y"
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
        label="Max run duration (minutes)"
        help={`Default: ${msToMin(GUARDRAIL_DEFAULTS.maxRunDurationMs)} minutes (2 hours). No server ceiling.`}
        value={msToMinOpt(guardrails.maxRunDurationMs)}
        placeholder={msToMin(GUARDRAIL_DEFAULTS.maxRunDurationMs)}
        error={fieldErrors["guardrails.maxRunDurationMs"]}
        onChange={(v) =>
          setGuardrailField(
            "maxRunDurationMs",
            v === undefined ? undefined : v * MS_PER_MIN,
          )
        }
      />

      <GuardrailNumberField
        id="step-timeout"
        label="Step timeout (minutes)"
        help={`Default: ${msToMin(GUARDRAIL_DEFAULTS.stepTimeoutMs)} minutes. Server allows up to ${msToMin(GUARDRAIL_CEILINGS.stepTimeoutMs)} minutes.`}
        value={msToMinOpt(guardrails.stepTimeoutMs)}
        placeholder={msToMin(GUARDRAIL_DEFAULTS.stepTimeoutMs)}
        ceiling={msToMin(GUARDRAIL_CEILINGS.stepTimeoutMs)}
        error={fieldErrors["guardrails.stepTimeoutMs"]}
        onChange={(v) =>
          setGuardrailField(
            "stepTimeoutMs",
            v === undefined ? undefined : v * MS_PER_MIN,
          )
        }
      />

      <hr className="border-border" />

      {/* Watchdog (M3-01) */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Watchdog
        </p>
      </div>

      {/* Enable watchdog switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor="watchdog-enabled">Enable watchdog</FieldLabel>
          <FieldHelp>
            When a step fails, an agent diagnoses it and can retry, skip, or
            pause the run.
          </FieldHelp>
        </div>
        <Switch
          id="watchdog-enabled"
          checked={watchdogEnabled}
          onCheckedChange={setWatchdogEnabled}
        />
      </div>

      {/* Progressive disclosure: show sub-fields only when watchdog is enabled */}
      {watchdogEnabled && (
        <>
          <div className="space-y-1">
            <FieldLabel htmlFor="watchdog-instructions">
              Watchdog instructions (optional)
            </FieldLabel>
            <Textarea
              id="watchdog-instructions"
              className="min-h-[60px] resize-y"
              value={watchdogInstructions}
              onChange={(e) => setWatchdogInstructions(e.target.value)}
              placeholder="e.g. Never retry deploy steps."
            />
            <FieldHelp>
              Standing guidance appended to every watchdog diagnosis prompt.
            </FieldHelp>
          </div>

          <div className="space-y-1">
            <FieldLabel htmlFor="watchdog-retry-budget">
              Retry budget per node
            </FieldLabel>
            <Input
              id="watchdog-retry-budget"
              type="number"
              className={cn(
                fieldErrors["watchdog.watchdogRetryBudget"]
                  ? "border-destructive"
                  : undefined,
              )}
              aria-invalid={
                fieldErrors["watchdog.watchdogRetryBudget"] ? true : undefined
              }
              value={watchdogRetryBudget}
              min={0}
              max={WATCHDOG_RETRY_BUDGET_MAX}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setWatchdogRetryBudget(
                  Number.isNaN(n)
                    ? WATCHDOG_RETRY_BUDGET_DEFAULT
                    : Math.max(0, Math.min(n, WATCHDOG_RETRY_BUDGET_MAX)),
                );
                setFieldErrors((prev) => ({
                  ...prev,
                  "watchdog.watchdogRetryBudget": undefined,
                }));
              }}
            />
            {fieldErrors["watchdog.watchdogRetryBudget"] ? (
              <FieldError
                message={fieldErrors["watchdog.watchdogRetryBudget"]!}
              />
            ) : (
              <FieldHelp>
                Max retries the watchdog may apply per node (0–
                {WATCHDOG_RETRY_BUDGET_MAX}). Default:{" "}
                {WATCHDOG_RETRY_BUDGET_DEFAULT}.
              </FieldHelp>
            )}
          </div>
        </>
      )}

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
  /** M3-01 watchdog settings */
  watchdogEnabled?: boolean;
  watchdogInstructions?: string | null;
  watchdogRetryBudget?: number;
};

export function LoopSettingsPanel({
  loopId,
  loopName,
  loopDescription,
  guardrails,
  watchdogEnabled,
  watchdogInstructions,
  watchdogRetryBudget,
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
              initialWatchdogEnabled={watchdogEnabled}
              initialWatchdogInstructions={watchdogInstructions}
              initialWatchdogRetryBudget={watchdogRetryBudget}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
