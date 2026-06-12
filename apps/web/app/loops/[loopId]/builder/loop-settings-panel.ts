/**
 * loop-settings-panel.ts — helpers for the loop settings panel.
 *
 * Stub — implementation in M2-02.
 */

import type { LoopGuardrails } from "@/lib/agent-loops/types";

export type LoopSettingsInput = {
  name: string;
  description?: string | null;
  guardrails?: LoopGuardrails;
};

export type LoopSettingsValidationResult =
  | { ok: true }
  | { ok: false; errors: Array<{ field: string; message: string }> };

/**
 * Validates loop settings for the settings panel form.
 * Enforces: name non-empty, guardrail fields positive and within server ceilings.
 */
export function validateLoopSettings(
  _input: LoopSettingsInput,
): LoopSettingsValidationResult {
  throw new Error("not implemented");
}
