/**
 * loop-settings-panel.ts — helpers and validation for the loop settings panel.
 *
 * Pure logic (no React) so it can be tested in isolation.
 * The React component is in loop-settings-panel.tsx.
 */

import type { LoopGuardrails } from "@/lib/agent-loops/types";
import { GUARDRAIL_CEILINGS } from "@/lib/agent-loops/types";

// ── Types ─────────────────────────────────────────────────────────────────────

/** M3-01 watchdog budget ceiling: max retries per node (0–5). */
export const WATCHDOG_RETRY_BUDGET_MAX = 5;
/** M3-01 watchdog budget default value. */
export const WATCHDOG_RETRY_BUDGET_DEFAULT = 2;

export type WatchdogSettings = {
  watchdogEnabled: boolean;
  watchdogInstructions?: string | null;
  watchdogRetryBudget?: number;
};

export type LoopSettingsInput = {
  name: string;
  description?: string | null;
  guardrails?: LoopGuardrails;
  watchdog?: WatchdogSettings;
};

export type LoopSettingsValidationError = {
  field: string;
  message: string;
};

export type LoopSettingsValidationResult =
  | { ok: true }
  | { ok: false; errors: LoopSettingsValidationError[] };

/**
 * Store-backed loop-settings state (#877). Lifted out of the settings panel's
 * local useState so the header Save button (single dirty-state / single save
 * path) can persist it alongside the graph definition.
 */
export type LoopSettingsState = {
  name: string;
  description: string;
  guardrails: Partial<LoopGuardrails>;
  watchdogEnabled: boolean;
  watchdogInstructions: string;
  watchdogRetryBudget: number;
};

export type BuildInitialLoopSettingsProps = {
  loopName: string;
  loopDescription?: string | null;
  loopGuardrails?: LoopGuardrails;
  watchdogEnabled?: boolean;
  watchdogInstructions?: string | null;
  watchdogRetryBudget?: number;
};

/** Maps BuilderCanvas props into the initial settings-panel state. */
export function buildInitialLoopSettings(
  props: BuildInitialLoopSettingsProps,
): LoopSettingsState {
  return {
    name: props.loopName,
    description: props.loopDescription ?? "",
    guardrails: props.loopGuardrails ?? {},
    watchdogEnabled: props.watchdogEnabled ?? false,
    watchdogInstructions: props.watchdogInstructions ?? "",
    watchdogRetryBudget:
      props.watchdogRetryBudget ?? WATCHDOG_RETRY_BUDGET_DEFAULT,
  };
}

/**
 * Builds the settings portion of the PATCH /api/agent-loops/:id body.
 * Empty guardrails send `null` (not undefined) so a fully-cleared guardrails
 * set actually clears the column instead of silently keeping stale values.
 */
export function settingsToUpdatePayload(state: LoopSettingsState): {
  name: string;
  description: string | null;
  guardrails: LoopGuardrails | null;
  watchdogEnabled: boolean;
  watchdogInstructions: string | null;
  watchdogRetryBudget: number;
} {
  const hasGuardrails = Object.keys(state.guardrails).length > 0;
  return {
    name: state.name,
    description: state.description || null,
    guardrails: hasGuardrails ? (state.guardrails as LoopGuardrails) : null,
    watchdogEnabled: state.watchdogEnabled,
    watchdogInstructions: state.watchdogEnabled
      ? state.watchdogInstructions || null
      : null,
    watchdogRetryBudget: state.watchdogRetryBudget,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates loop settings for the settings panel form.
 * Enforces:
 *   - name: non-empty (after trim)
 *   - guardrail fields: must be positive integers
 *   - guardrail fields: must not exceed server-enforced ceilings
 */
export function validateLoopSettings(
  input: LoopSettingsInput,
): LoopSettingsValidationResult {
  const errors: LoopSettingsValidationError[] = [];

  // Name validation
  if (!input.name || input.name.trim().length === 0) {
    errors.push({ field: "name", message: "Name is required." });
  }

  // Guardrail validation
  if (input.guardrails) {
    const g = input.guardrails;

    if (g.maxStepsPerRun !== undefined) {
      if (g.maxStepsPerRun <= 0 || !Number.isInteger(g.maxStepsPerRun)) {
        errors.push({
          field: "guardrails.maxStepsPerRun",
          message: "maxStepsPerRun must be a positive integer.",
        });
      } else if (g.maxStepsPerRun > GUARDRAIL_CEILINGS.maxStepsPerRun) {
        errors.push({
          field: "guardrails.maxStepsPerRun",
          message: `maxStepsPerRun cannot exceed the server ceiling of ${GUARDRAIL_CEILINGS.maxStepsPerRun}.`,
        });
      }
    }

    if (g.maxIterations !== undefined) {
      if (g.maxIterations <= 0 || !Number.isInteger(g.maxIterations)) {
        errors.push({
          field: "guardrails.maxIterations",
          message: "maxIterations must be a positive integer.",
        });
      } else if (g.maxIterations > GUARDRAIL_CEILINGS.maxIterations) {
        errors.push({
          field: "guardrails.maxIterations",
          message: `maxIterations cannot exceed the server ceiling of ${GUARDRAIL_CEILINGS.maxIterations}.`,
        });
      }
    }

    if (g.stepTimeoutMs !== undefined) {
      if (g.stepTimeoutMs <= 0 || !Number.isInteger(g.stepTimeoutMs)) {
        errors.push({
          field: "guardrails.stepTimeoutMs",
          message: "stepTimeoutMs must be a positive integer.",
        });
      } else if (g.stepTimeoutMs > GUARDRAIL_CEILINGS.stepTimeoutMs) {
        errors.push({
          field: "guardrails.stepTimeoutMs",
          message: `stepTimeoutMs cannot exceed the server ceiling of ${GUARDRAIL_CEILINGS.stepTimeoutMs}.`,
        });
      }
    }

    if (g.maxAgentTurnsPerStep !== undefined) {
      if (
        g.maxAgentTurnsPerStep <= 0 ||
        !Number.isInteger(g.maxAgentTurnsPerStep)
      ) {
        errors.push({
          field: "guardrails.maxAgentTurnsPerStep",
          message: "maxAgentTurnsPerStep must be a positive integer.",
        });
      } else if (
        g.maxAgentTurnsPerStep > GUARDRAIL_CEILINGS.maxAgentTurnsPerStep
      ) {
        errors.push({
          field: "guardrails.maxAgentTurnsPerStep",
          message: `maxAgentTurnsPerStep cannot exceed the server ceiling of ${GUARDRAIL_CEILINGS.maxAgentTurnsPerStep}.`,
        });
      }
    }

    // maxRunDurationMs has no server ceiling — only positivity check
    if (g.maxRunDurationMs !== undefined) {
      if (g.maxRunDurationMs <= 0 || !Number.isInteger(g.maxRunDurationMs)) {
        errors.push({
          field: "guardrails.maxRunDurationMs",
          message: "maxRunDurationMs must be a positive integer.",
        });
      }
    }
  }

  // Watchdog validation (M3-01)
  if (input.watchdog?.watchdogEnabled) {
    const budget = input.watchdog.watchdogRetryBudget;
    if (budget !== undefined) {
      if (!Number.isInteger(budget) || budget < 0) {
        errors.push({
          field: "watchdog.watchdogRetryBudget",
          message: "Retry budget must be a non-negative integer.",
        });
      } else if (budget > WATCHDOG_RETRY_BUDGET_MAX) {
        errors.push({
          field: "watchdog.watchdogRetryBudget",
          message: `Retry budget cannot exceed ${WATCHDOG_RETRY_BUDGET_MAX}.`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
