"use client";

/**
 * loop-settings-panel.tsx — Gear button in the builder top bar opens a docked
 * panel for editing loop-level settings: name, description, guardrails, and watchdog.
 *
 * #877: this panel used to hold its own local state and its own "Save
 * settings" fetch, completely disconnected from the header Save button and
 * the builder's isDirty flag. Every field now reads/writes the shared
 * builder store (`store.getState().updateSettings`), so editing any field
 * marks the header dirty and the header Save persists it in one PATCH
 * alongside the graph definition (see builder-canvas.tsx's handleSave).
 */

import { useState } from "react";
import { Settings } from "lucide-react";
import { useStore } from "zustand";
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
  WATCHDOG_RETRY_BUDGET_DEFAULT,
  WATCHDOG_RETRY_BUDGET_MAX,
} from "./loop-settings-panel";
import type { CreateLoopBuilderStoreReturn } from "./use-loop-builder";
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

export type LoopSettingsPanelContentProps = {
  store: CreateLoopBuilderStoreReturn;
  onClose: () => void;
};

export function LoopSettingsPanelContent({
  store,
  onClose,
}: LoopSettingsPanelContentProps) {
  const settings = useStore(store, (s) => s.settings);
  const fieldErrors = useStore(store, (s) => s.settingsErrors);
  const updateSettings = useStore(store, (s) => s.updateSettings);

  const {
    name,
    description,
    guardrails,
    watchdogEnabled,
    watchdogInstructions,
    watchdogRetryBudget,
  } = settings;

  function setGuardrailField(
    key: GuardrailFieldKey,
    value: number | undefined,
  ) {
    const nextGuardrails = { ...guardrails };
    if (value === undefined) {
      delete nextGuardrails[key];
    } else {
      nextGuardrails[key] = value;
    }
    updateSettings({ guardrails: nextGuardrails });
    // updateSettings only clears the "guardrails" error key; also clear the
    // nested per-field guardrail error explicitly.
    const current = store.getState().settingsErrors;
    store.getState().setSettingsErrors({
      ...current,
      [`guardrails.${key}`]: undefined,
    });
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
          onChange={(e) => updateSettings({ name: e.target.value })}
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
          onChange={(e) => updateSettings({ description: e.target.value })}
          placeholder="What does this loop do?"
        />
      </div>

      <hr className="border-border" />

      {/* Guardrails (labeled "Safety limits" for a naive-user audience) */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Safety limits
        </p>
        <p className="text-[11px] text-muted-foreground">
          Limits on how long and how far a run can go before it&apos;s stopped
          automatically.
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
        help={`Bounds each agent_step's agent invocation. Default: ${msToMin(GUARDRAIL_DEFAULTS.stepTimeoutMs)} minutes. Server allows up to ${msToMin(GUARDRAIL_CEILINGS.stepTimeoutMs)} minutes. A step's checkCommand has its own fixed 2-minute timeout, unaffected by this setting.`}
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

      <GuardrailNumberField
        id="max-agent-turns"
        label="Agent turns per step"
        help={`Max model turns each agent step may take before the run fails. Default: ${GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep}. Server enforces a ceiling of ${GUARDRAIL_CEILINGS.maxAgentTurnsPerStep}.`}
        value={guardrails.maxAgentTurnsPerStep}
        placeholder={GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep}
        ceiling={GUARDRAIL_CEILINGS.maxAgentTurnsPerStep}
        error={fieldErrors["guardrails.maxAgentTurnsPerStep"]}
        onChange={(v) => setGuardrailField("maxAgentTurnsPerStep", v)}
      />

      <hr className="border-border" />

      {/* Watchdog (M3-01), labeled "Auto-recovery (watchdog)" for clarity */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Auto-recovery (watchdog)
        </p>
        <p className="text-[11px] text-muted-foreground">
          When a step fails, let an agent diagnose it and decide whether to
          retry, skip, or pause the run.
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
          onCheckedChange={(checked) =>
            updateSettings({ watchdogEnabled: checked })
          }
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
              onChange={(e) =>
                updateSettings({ watchdogInstructions: e.target.value })
              }
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
                updateSettings({
                  watchdogRetryBudget: Number.isNaN(n)
                    ? watchdogRetryBudget
                    : Math.max(0, Math.min(n, WATCHDOG_RETRY_BUDGET_MAX)),
                });
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

      {/* Footer — the header top-bar Save button persists these settings */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-muted-foreground">
          Changes are saved with the Save button in the top bar.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

// ── LoopSettingsPanel ─────────────────────────────────────────────────────────

export type LoopSettingsPanelProps = {
  store: CreateLoopBuilderStoreReturn;
};

export function LoopSettingsPanel({ store }: LoopSettingsPanelProps) {
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
              store={store}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
